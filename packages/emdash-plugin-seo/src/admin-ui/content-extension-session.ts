import { QueryClient } from "@tanstack/react-query";

import { createEntrySchemaPanelStore, type EntrySchemaPanelStore } from "./entry-schema-model.ts";

export const contentExtensionQueryClient = new QueryClient({
	defaultOptions: {
		queries: {
			refetchOnReconnect: false,
			refetchOnWindowFocus: false,
			retry: 1,
		},
	},
});

// One store per entry for the editor session: the Schema view can unmount on a
// tab switch or dialog close while a write is pending or unconfirmed.
const entrySchemaPanelStores = new Map<string, EntrySchemaPanelStore>();
export function entrySchemaPanelStoreFor(ref: string): EntrySchemaPanelStore {
	let store = entrySchemaPanelStores.get(ref);
	if (!store) {
		store = createEntrySchemaPanelStore();
		entrySchemaPanelStores.set(ref, store);
	}
	return store;
}
