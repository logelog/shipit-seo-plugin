import assert from "node:assert/strict";

import {
	SOCIAL_REQUEST_DEADLINE_MS,
	SocialRequestTimeoutError,
	runSocialRequest,
} from "./social-request.ts";

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
	return { promise, resolve, reject };
}

function clock() {
	let expire: (() => void) | undefined;
	let schedules = 0;
	let disposals = 0;
	return {
		options: { scheduleDeadline: (callback: () => void, delay: number) => {
			assert.equal(delay, 15_000, "the entire operation gets the fixed production deadline");
			schedules++;
			expire = callback;
			return () => { disposals++; };
		} },
		fire: () => { assert.ok(expire); expire(); },
		counts: () => ({ schedules, disposals }),
	};
}

function trackedSignal(controller = new AbortController()) {
	const signal = controller.signal;
	const add = signal.addEventListener.bind(signal);
	const remove = signal.removeEventListener.bind(signal);
	let additions = 0;
	let removals = 0;
	signal.addEventListener = ((...args: any[]) => {
		if (args[0] === "abort") additions++;
		(add as any)(...args);
	}) as typeof signal.addEventListener;
	signal.removeEventListener = ((...args: any[]) => {
		if (args[0] === "abort") removals++;
		(remove as any)(...args);
	}) as typeof signal.removeEventListener;
	return { controller, signal, counts: () => ({ additions, removals }) };
}

assert.equal(SOCIAL_REQUEST_DEADLINE_MS, 15_000);
const unhandled: unknown[] = [];
const onUnhandled = (error: unknown) => { unhandled.push(error); };
process.on("unhandledRejection", onUnhandled);
try {
	// The callback ignores abort and never settles; the wrapper must still reject.
	const hangingClock = clock();
	const hangingExternal = trackedSignal();
	let hangingSignal!: AbortSignal;
	let hangingCalls = 0;
	const hanging = runSocialRequest((signal) => {
		hangingCalls++;
		hangingSignal = signal;
		return new Promise<never>(() => {});
	}, hangingExternal.signal, hangingClock.options);
	const hangingRejected = assert.rejects(hanging, (error: unknown) => {
		assert.ok(error instanceof SocialRequestTimeoutError);
		assert.equal(error.name, "SocialRequestTimeoutError");
		assert.match(error.message, /could not be confirmed/);
		assert.match(error.message, /may already be stored/);
		return true;
	});
	hangingClock.fire();
	await hangingRejected;
	assert.equal(hangingCalls, 1, "a timeout does not retry");
	assert.equal(hangingSignal.aborted, true);
	assert.equal(hangingSignal.reason instanceof SocialRequestTimeoutError, true);
	assert.deepEqual(hangingClock.counts(), { schedules: 1, disposals: 1 });
	assert.deepEqual(hangingExternal.counts(), { additions: 1, removals: 1 });

	// Fetch can finish while the response body is still pending inside the callback.
	const body = deferred<string>();
	const bodyStarted = deferred<void>();
	const bodyClock = clock();
	let bodySignal!: AbortSignal;
	const waitingForBody = runSocialRequest(async (signal) => {
		bodySignal = signal;
		const response = await Promise.resolve({ text: () => body.promise });
		bodyStarted.resolve();
		return await response.text();
	}, undefined, bodyClock.options);
	await bodyStarted.promise;
	const bodyRejected = assert.rejects(waitingForBody, SocialRequestTimeoutError);
	bodyClock.fire();
	await bodyRejected;
	assert.equal(bodySignal.aborted, true);
	body.resolve("late body");
	await Promise.resolve();
	assert.deepEqual(bodyClock.counts(), { schedules: 1, disposals: 1 });

	// Ordinary success/rejection dispose resources without aborting a finished operation.
	const successClock = clock();
	const successExternal = trackedSignal();
	let successSignal!: AbortSignal;
	const value = { stored: true };
	assert.equal(await runSocialRequest(async (signal) => {
		successSignal = signal;
		return value;
	}, successExternal.signal, successClock.options), value);
	assert.equal(successSignal.aborted, false);
	assert.deepEqual(successClock.counts(), { schedules: 1, disposals: 1 });
	assert.deepEqual(successExternal.counts(), { additions: 1, removals: 1 });
	successClock.fire();
	successExternal.controller.abort(new Error("after completion"));
	assert.equal(successSignal.aborted, false, "disposed deadline/listener cannot interrupt completed work");

	const failureClock = clock();
	const failureExternal = trackedSignal();
	const originalError = new Error("original failure");
	let failureSignal!: AbortSignal;
	await assert.rejects(runSocialRequest(async (signal) => {
		failureSignal = signal;
		throw originalError;
	}, failureExternal.signal, failureClock.options), (error) => error === originalError);
	assert.equal(failureSignal.aborted, false);
	assert.deepEqual(failureClock.counts(), { schedules: 1, disposals: 1 });
	assert.deepEqual(failureExternal.counts(), { additions: 1, removals: 1 });
	const synchronousClock = clock();
	await assert.rejects(runSocialRequest(() => { throw originalError; }, undefined, synchronousClock.options),
		(error) => error === originalError);
	assert.deepEqual(synchronousClock.counts(), { schedules: 1, disposals: 1 });

	// Late rejection is consumed, and late resolution cannot replace the timeout outcome.
	for (const lateKind of ["resolve", "reject"] as const) {
		const late = deferred<string>();
		const lateClock = clock();
		let settlements = 0;
		const operation = runSocialRequest(() => late.promise, undefined, lateClock.options);
		const observed = operation.then(() => { settlements++; }, (error) => {
			settlements++;
			assert.ok(error instanceof SocialRequestTimeoutError);
		});
		lateClock.fire();
		await observed;
		if (lateKind === "resolve") late.resolve("too late");
		else late.reject(new Error("late transport rejection"));
		await Promise.resolve();
		await Promise.resolve();
		assert.equal(settlements, 1);
		assert.deepEqual(lateClock.counts(), { schedules: 1, disposals: 1 });
	}

	// An already-aborted signal dispatches neither callback nor timer.
	const before = trackedSignal();
	const beforeReason = new Error("already interrupted");
	before.controller.abort(beforeReason);
	const beforeClock = clock();
	let beforeCalls = 0;
	await assert.rejects(runSocialRequest(async () => {
		beforeCalls++;
		return "unreachable";
	}, before.signal, beforeClock.options), (error) => error === beforeReason);
	assert.equal(beforeCalls, 0);
	assert.deepEqual(beforeClock.counts(), { schedules: 0, disposals: 0 });
	assert.equal(before.counts().additions, 0);

	// External abort also settles an abort-ignoring callback and removes its listener.
	const external = trackedSignal();
	const externalClock = clock();
	const ignored = deferred<string>();
	let externalOperationSignal!: AbortSignal;
	const interrupted = runSocialRequest((signal) => {
		externalOperationSignal = signal;
		return ignored.promise;
	}, external.signal, externalClock.options);
	const externalReason = new Error("editor changed");
	const externalRejected = assert.rejects(interrupted, (error) => error === externalReason);
	external.controller.abort(externalReason);
	await externalRejected;
	assert.equal(externalOperationSignal.aborted, true);
	assert.equal(externalOperationSignal.reason, externalReason);
	assert.deepEqual(externalClock.counts(), { schedules: 1, disposals: 1 });
	assert.deepEqual(external.counts(), { additions: 1, removals: 1 });
	externalClock.fire();
	ignored.reject(new Error("late rejection after external abort"));

	// Abort during timer registration wins, and its newly returned timer is disposed.
	const registration = trackedSignal();
	let registrationCalls = 0;
	let registrationDisposals = 0;
	const registrationReason = new Error("interrupted while scheduling");
	await assert.rejects(runSocialRequest(async () => {
		registrationCalls++;
		return "unreachable";
	}, registration.signal, { scheduleDeadline: () => {
		registration.controller.abort(registrationReason);
		return () => { registrationDisposals++; };
	} }), (error) => error === registrationReason);
	assert.equal(registrationCalls, 0);
	assert.equal(registrationDisposals, 1);
	assert.deepEqual(registration.counts(), { additions: 1, removals: 1 });

	await new Promise<void>((resolve) => setImmediate(resolve));
	assert.deepEqual(unhandled, [], "ignored aborts and late rejections do not leak unhandled promises");
} finally {
	process.removeListener("unhandledRejection", onUnhandled);
}

console.log("Social request deadline and interruption self-checks passed.");
