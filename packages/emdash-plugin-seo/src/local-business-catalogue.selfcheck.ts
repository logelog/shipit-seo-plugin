import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
	LOCAL_BUSINESS_CATALOGUE_SOURCE,
	LOCAL_BUSINESS_TYPES,
	isFoodEstablishmentType,
	isLocalBusinessType,
	isPublisherSchemaType,
	localBusinessAncestors,
	localBusinessClassLabel,
	localBusinessTypeExclusion,
	localBusinessTypeIsA,
	localBusinessTypeMatches,
} from "./local-business-catalogue.ts";
import { LOCAL_BUSINESS_EXCLUDED_TYPES, LOCAL_BUSINESS_EXTERNAL_PARENTS } from "./local-business-types.ts";

// ---- Release and membership ----
assert.equal(LOCAL_BUSINESS_CATALOGUE_SOURCE.release, "30.1");
assert.equal(LOCAL_BUSINESS_CATALOGUE_SOURCE.sha256, "0a4b8c4c910fc831ec8695196510973390906a5ee34dc6b862dfec4d21a12f74");
assert.equal(LOCAL_BUSINESS_CATALOGUE_SOURCE.licence, "CC BY-SA 3.0");
assert.equal(LOCAL_BUSINESS_TYPES.length, 129, "131 LocalBusiness classes in 30.1, less the two deprecated ones");
const ids = LOCAL_BUSINESS_TYPES.map((info) => info.id);
assert.equal(new Set(ids).size, ids.length, "identifiers are unique");
assert.deepEqual([...ids].sort(), ids, "rows are in identifier order, so a regenerated diff is reviewable");
for (const type of ["LocalBusiness", "Store", "Restaurant", "Dentist"]) {
	assert.equal(isLocalBusinessType(type), true, `${type} records saved before the catalogue stay valid`);
}
for (const type of ["HairSalon", "Bakery", "MedicalClinic", "Optician", "CovidTestingFacility", "SkiResort"]) {
	assert.equal(isLocalBusinessType(type), true, `${type} is selectable`);
}

// ---- Exclusions ----
assert.deepEqual(
	LOCAL_BUSINESS_EXCLUDED_TYPES.map((item) => item.id),
	["Attorney", "ProfessionalService"],
);
for (const type of ["Attorney", "ProfessionalService"]) {
	assert.equal(isLocalBusinessType(type), false, `${type} is deprecated and not offered`);
	assert.match(localBusinessTypeExclusion(type) ?? "", /Deprecated/);
}
// MedicalSpecialty enumeration values carry subclass triples in the dataset but are not classes.
for (const value of ["Dermatology", "Pediatric", "PrimaryCare", "Optometric"]) {
	assert.equal(isLocalBusinessType(value), false, `${value} is an enumeration value, not a business type`);
	assert.equal(localBusinessTypeExclusion(value), null);
}
for (const value of ["Bakeryy", "restaurant", "Organization", "Place", "Thing", "", "__proto__", "constructor"]) {
	assert.equal(isLocalBusinessType(value), false, `${JSON.stringify(value)} is not a catalogue type`);
}
assert.equal(isLocalBusinessType(undefined), false);

// ---- Parents and ancestry ----
const external = new Set(Object.keys(LOCAL_BUSINESS_EXTERNAL_PARENTS));
assert.deepEqual([...external].sort(), ["CivicStructure", "MedicalOrganization", "Organization", "Place"]);
for (const info of LOCAL_BUSINESS_TYPES) {
	assert.ok(info.parents.length > 0, `${info.id} has a parent`);
	for (const parent of info.parents) {
		assert.ok(isLocalBusinessType(parent) || external.has(parent), `${info.id}'s parent ${parent} is in the catalogue or named outside it`);
	}
	const ancestors = localBusinessAncestors(info.id);
	assert.ok(ancestors.includes("Organization") && ancestors.includes("Place"), `${info.id} is both an Organization and a Place`);
	assert.ok(!ancestors.includes(info.id) && !ancestors.includes("Thing"));
	if (info.id !== "LocalBusiness") assert.ok(localBusinessTypeIsA(info.id, "LocalBusiness"), `${info.id} descends from LocalBusiness`);
}
const parentsOf = (id: string) => LOCAL_BUSINESS_TYPES.find((info) => info.id === id)?.parents;
assert.deepEqual(parentsOf("Dentist"), ["LocalBusiness", "MedicalBusiness", "MedicalOrganization"], "Dentist keeps all three parents");
assert.deepEqual(parentsOf("Restaurant"), ["FoodEstablishment"]);
assert.deepEqual(parentsOf("LocalBusiness"), ["Organization", "Place"]);
assert.deepEqual(parentsOf("AutoPartsStore"), ["AutomotiveBusiness", "Store"]);
assert.deepEqual(parentsOf("Hospital"), ["CivicStructure", "EmergencyService", "MedicalOrganization"]);
assert.deepEqual(localBusinessAncestors("HairSalon"), ["HealthAndBeautyBusiness", "LocalBusiness", "Organization", "Place"]);
assert.deepEqual(localBusinessAncestors("Restaurant"), ["FoodEstablishment", "LocalBusiness", "Organization", "Place"]);
assert.deepEqual(localBusinessAncestors("Dentist"), ["LocalBusiness", "MedicalBusiness", "MedicalOrganization", "Organization", "Place"]);
assert.ok(localBusinessTypeIsA("Dentist", "MedicalOrganization") && localBusinessTypeIsA("Dentist", "MedicalBusiness"));
assert.deepEqual(localBusinessAncestors("Attorney"), ["LegalService", "LocalBusiness", "Organization", "Place"], "excluded types keep their ancestry");
assert.deepEqual(localBusinessAncestors("Dermatology"), [], "enumeration values have no ancestry here");
assert.equal(localBusinessTypeIsA("Organization", "Organization"), false, "only catalogue types answer");
assert.equal(localBusinessClassLabel("MedicalOrganization"), "Medical organization");
assert.equal(localBusinessClassLabel("HealthAndBeautyBusiness"), "Health and beauty business");

// ---- Families and extensions ----
assert.deepEqual(
	LOCAL_BUSINESS_TYPES.filter((info) => isFoodEstablishmentType(info.id)).map((info) => info.id),
	["Bakery", "BarOrPub", "Brewery", "CafeOrCoffeeShop", "Distillery", "FastFoodRestaurant", "FoodEstablishment", "IceCreamShop", "Restaurant", "Winery"],
);
assert.equal(isFoodEstablishmentType("HairSalon"), false);
assert.equal(isFoodEstablishmentType("Store"), false);
assert.equal(isFoodEstablishmentType("Bakeryy"), false);
assert.deepEqual(
	LOCAL_BUSINESS_TYPES.filter((info) => info.extension === "health-lifesci").map((info) => info.id),
	["MedicalBusiness", "MedicalClinic", "Optician"],
);

// ---- Labels and search ----
const labelOf = (id: string) => LOCAL_BUSINESS_TYPES.find((info) => info.id === id)?.label;
assert.equal(labelOf("HairSalon"), "Hair salon");
assert.equal(labelOf("HVACBusiness"), "HVAC business");
assert.equal(labelOf("CafeOrCoffeeShop"), "Cafe or coffee shop");
const search = (query: string) => LOCAL_BUSINESS_TYPES.filter((info) => localBusinessTypeMatches(info, query)).map((info) => info.id);
assert.deepEqual(search("hair salon"), ["HairSalon"]);
assert.deepEqual(search("HairSalon"), ["HairSalon"]);
assert.deepEqual(search(" hair-SALON "), ["HairSalon"]);
assert.deepEqual(search("salon"), ["BeautySalon", "HairSalon", "NailSalon"]);
assert.deepEqual(search("hvac"), ["HVACBusiness"]);
assert.deepEqual(search("no such business"), []);
assert.equal(search("").length, 129);

// ---- Publisher types for public inspection ----
for (const type of ["HairSalon", "Bakery", "Optician", "Organization", "Person", "LocalBusiness", "Attorney", "ProfessionalService", "MedicalOrganization"]) {
	assert.equal(isPublisherSchemaType(type), true, `${type} is recognised as a publisher`);
}
for (const type of ["WebSite", "WebPage", "Place", "Dermatology", "Thing", "BlogPosting", 42]) {
	assert.equal(isPublisherSchemaType(type), false, `${String(type)} is not a publisher`);
}

// ---- Generated file matches the release, when the developer dataset is present ----
const dataset = fileURLToPath(new URL("../../../artifacts/local-business-types-research/schemaorg-current-https-30.1.jsonld", import.meta.url));
if (existsSync(dataset)) {
	const result = spawnSync(
		process.execPath,
		[fileURLToPath(new URL("../scripts/generate-local-business-types.mjs", import.meta.url)), dataset, "--check"],
		{ encoding: "utf8" },
	);
	assert.equal(result.status, 0, `the generated catalogue differs from the dataset: ${result.stderr}`);
	console.log(result.stdout.trim());
} else {
	console.log("local business catalogue: release dataset not present, regeneration comparison not run");
}

console.log("local business catalogue selfcheck passed");
