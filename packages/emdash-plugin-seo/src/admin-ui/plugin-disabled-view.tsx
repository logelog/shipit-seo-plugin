import { Plugs } from "@phosphor-icons/react";

import { useSeoBrand } from "./brand-context.ts";
import { useSeoI18n } from "./i18n/index.ts";
import { SEO_PLUGINS_MANAGER_URL } from "./plugin-availability-model.ts";

/** Stands in for the whole workspace while EmDash has the plugin disabled; it sends no request. */
export function SeoPluginDisabledState() {
	const { t } = useSeoI18n();
	const brand = useSeoBrand();
	return (
		<div className="shipit-seo-admin">
			<section className="shipit-seo-panel shipit-seo-plugin-disabled" role="status" aria-labelledby="seo-plugin-disabled-title">
				<span className="shipit-seo-plugin-disabled__icon" aria-hidden="true">
					<Plugs size={26} weight="fill" />
				</span>
				<h2 id="seo-plugin-disabled-title">{t("plugin.disabled.title", { brand: brand.name })}</h2>
				<p>{t("plugin.disabled.body")}</p>
				<a className="shipit-seo-plugin-disabled__action" href={SEO_PLUGINS_MANAGER_URL}>{t("plugin.disabled.action")}</a>
			</section>
		</div>
	);
}
