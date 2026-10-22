import * as React from "react";

/**
 * Class names that let a Kumo tab strip wrap onto further rows in a narrow
 * workspace. Kumo hides the scrollbar of an overflowing strip, so a tab
 * scrolled out of view would otherwise be invisible. Spread after `variant`.
 */
export const WRAPPING_TABS = {
	className: "shipit-seo-tabs-wrap",
	listClassName: "shipit-seo-tabs-wrap__list",
} as const;

/** The underline variant also moves its indicator under the active tab's own row. */
export const WRAPPING_UNDERLINE_TABS = {
	...WRAPPING_TABS,
	indicatorClassName: "shipit-seo-tabs-wrap__underline",
} as const;

/** Selects the tablist of a wrapping strip that is a direct child of the element holding the ref. */
export const OWN_TABLIST_SELECTOR = ':scope > .shipit-seo-tabs-wrap > [role="tablist"]';

/**
 * Names the tablist of the wrapping strip directly inside the returned ref's element, because
 * Kumo Tabs passes no props to its list. Nested strips deeper in the element keep their own names.
 */
export function useTablistName<T extends HTMLElement>(name: { label: string } | { labelledBy: string }): React.RefObject<T | null> {
	const ref = React.useRef<T>(null);
	const [attribute, value] = "label" in name ? ["aria-label", name.label] : ["aria-labelledby", name.labelledBy];
	React.useLayoutEffect(() => {
		ref.current?.querySelector(OWN_TABLIST_SELECTOR)?.setAttribute(attribute, value);
	});
	return ref;
}
