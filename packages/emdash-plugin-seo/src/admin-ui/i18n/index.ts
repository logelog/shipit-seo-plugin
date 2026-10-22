import * as EmDashAdmin from "@emdash-cms/admin";
import { useMemo } from "react";

import { createSeoI18n } from "./messages.ts";

export { createSeoI18n, formatSeoDate, formatSeoNumber, resolveSeoLocale } from "./messages.ts";
export type { SeoI18n, SeoMessageKey, SeoMessageParameters, SeoTranslate } from "./messages.ts";

const hostLocaleHook: unknown = Reflect.get(EmDashAdmin, "useLocale");
const useAdminLocale: () => { locale: string } = typeof hostLocaleHook === "function"
	? hostLocaleHook as () => { locale: string }
	: () => ({ locale: "en" });

export function useSeoI18n() {
	const { locale } = useAdminLocale();
	return useMemo(() => createSeoI18n(locale), [locale]);
}
