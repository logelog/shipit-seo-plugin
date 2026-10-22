import type { ContentEditorPanelExtension, ContentListColumnExtension } from "@emdash-cms/admin";

import { SeoEditorPanelRoot, SeoScoreCellRoot } from "./content-extensions.tsx";

export const contentListColumns: ContentListColumnExtension[] = [
	{
		id: "shipit-seo:score",
		label: "SEO",
		order: 50,
		align: "start",
		cell: SeoScoreCellRoot,
	},
];

export const contentEditorPanels: ContentEditorPanelExtension[] = [
	{
		id: "shipit-seo:analysis",
		title: "Advanced SEO",
		order: 50,
		component: SeoEditorPanelRoot,
	},
];
