import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchSeoAdminSitemap } from "./api.ts";
import { ContentTypeIndexingControls } from "./content-type-indexing-controls.tsx";
import { useSeoI18n } from "./i18n/index.ts";
import { ContractMismatchScreen } from "./workspace-shell.tsx";
import { isSeoContractMismatchError, seoWorkspaceKeys } from "./workspace-model.ts";

/** Reads the Sitemaps configuration the Sitemaps page shares, so both show the same state. */
export function ContentTypeIndexingContainer({ selected, saved, disabled, siteNoindex, savedSiteNoindex, unconfirmed = false, validationError, onChange, onOpenSitemaps, active = true }: {
	selected: readonly string[]; saved: readonly string[]; disabled: boolean; siteNoindex: boolean; savedSiteNoindex: boolean; unconfirmed?: boolean; validationError?: string;
	onChange: (names: string[]) => void; onOpenSitemaps?: () => void;
	/** False while Indexing rules is hidden behind another page: the read is passive until it shows again. */
	active?: boolean;
}) {
	const { t } = useSeoI18n();
	const query = useQuery({
		queryKey: seoWorkspaceKeys.sitemap,
		queryFn: () => fetchSeoAdminSitemap(),
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
		retry: 1,
		staleTime: 20_000,
		enabled: active,
	});
	const retry = () => {
		if (!disabled && !query.isFetching) void query.refetch({ cancelRefetch: false });
	};
	if (query.isError && isSeoContractMismatchError(query.error)) return <ContractMismatchScreen error={query.error} onRetry={retry} />;
	const error = query.isError ? query.error instanceof Error ? query.error.message : t("indexing.types.unavailable") : null;
	return <ContentTypeIndexingControls selected={selected} saved={saved} sitemap={query.data ?? null}
		loading={query.isPending || query.isFetching} error={error} validationError={validationError}
		disabled={disabled} siteNoindex={siteNoindex} savedSiteNoindex={savedSiteNoindex} unconfirmed={unconfirmed}
		onChange={(names) => { if (!disabled) onChange(names); }}
		onRetry={retry} onOpenSitemaps={onOpenSitemaps} />;
}
