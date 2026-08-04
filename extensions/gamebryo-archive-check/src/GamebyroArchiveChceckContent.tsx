import { types } from "@nexusmods/vortex-api";
import type { FC } from "react";

import DetailView from "./views/DetailView";
import ListingRow from "./views/ListingRow";

interface IListingRowProps {
  api: types.IExtensionApi;
  entry: types.IHealthCheckEntry;
  isHidden: boolean;
  onOpen: () => void;
  onToggleHide: () => void;
}

interface IDetailViewProps {
  entry: types.IHealthCheckEntry;
  api: types.IExtensionApi;
  onBack: () => void;
}

interface IBulkInstallItem {
  /** Stable key for de-duplication across checks (the file/mod to download). */
  key: string;
  /** Trigger this item's download/install. */
  install: () => void;
}

interface IHealthCheckContent {
  /** Map this check's result (from state) into listing entries. */
  selectEntries: (state: types.IState) => types.IHealthCheckEntry[];
  /** Renders a listing row for one of this check's entries. */
  ListingRow: FC<IListingRowProps>;
  /** Renders the detail body (below the shared chrome) for one entry. */
  DetailView: FC<IDetailViewProps>;
  /** Whether the shell offers hide controls (tabs / hide-all) for this check. */
  supportsHide?: boolean;
  /** Whether the given entry is currently hidden (provider-owned state). */
  isHidden?: (state: types.IState, entry: types.IHealthCheckEntry) => boolean;
  /** Toggle hidden for the entry the control was activated on (the click context). */
  toggleHide?: (api: types.IExtensionApi, entry: types.IHealthCheckEntry) => void;
  /**
   * No-choice download/install items contributed to the page-level "1-click
   * install all" button. Excludes anything needing a user choice (OR) or a
   * non-download action (enable/switch). Omit when nothing is one-click-installable.
   * TODO(LAZ-471): extend to enable/switch/reinstall cases once that scope is agreed.
   */
  collectInstallAll?: (state: types.IState, api: types.IExtensionApi) => IBulkInstallItem[];
}

export const fileRequirementsContent: IHealthCheckContent = {
  selectEntries: (state: types.IState) => {
    return [];
  },
  ListingRow,
  DetailView,
  // supportsHide: true,
  // isHidden: (state, entry) => {
  //     return false;
  // },
  // toggleHide: (api, entry) => {

  // }
};
