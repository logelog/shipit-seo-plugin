import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useSeoI18n } from "./i18n/index.ts";
import { fetchIndexingTaxonomies } from "./taxonomy-indexing-api.ts";
import { TaxonomyIndexingControls } from "./taxonomy-indexing-controls.tsx";
import { ContractMismatchScreen } from "./workspace-shell.tsx";
import { isSeoContractMismatchError, seoWorkspaceKeys } from "./workspace-model.ts";

export function TaxonomyIndexingContainer({ selected, saved, disabled, siteNoindex, savedSiteNoindex, unconfirmed = false, validationError, onChange, active = true }: {
	selected: readonly string[]; saved: readonly string[]; disabled: boolean; siteNoindex: boolean; savedSiteNoindex: boolean; unconfirmed?: boolean; validationError?: string;
	onChange: (names: string[]) => void;
	/** False while Indexing rules is hidden behind another page: the read is passive until it shows again. */
	active?: boolean;
}) {
	const { t } = useSeoI18n();
	const query = useQuery({
		queryKey: seoWorkspaceKeys.indexingTaxonomies,
		queryFn: ({ signal }) => fetchIndexingTaxonomies(signal),
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
		retry: false,
		staleTime: 60_000,
		enabled: active,
	});
	const retry = () => {
		if (!disabled && !query.isFetching) void query.refetch({ cancelRefetch: false });
	};
	if (query.isError && isSeoContractMismatchError(query.error)) return <ContractMismatchScreen error={query.error} onRetry={retry} />;
	const available = !query.isError && query.data?.available === true;
	const error = query.isError || query.data?.available === false ? t("indexing.archives.unavailable") : null;
	return <TaxonomyIndexingControls selected={selected} saved={saved} definitions={available ? query.data!.items : null}
		loading={query.isPending || query.isFetching} error={error} validationError={validationError}
		truncated={available && query.data!.truncated} disabled={disabled} siteNoindex={siteNoindex} savedSiteNoindex={savedSiteNoindex} unconfirmed={unconfirmed}
		onChange={(names) => { if (!disabled) onChange(names); }}
		onRetry={retry} />;
}
