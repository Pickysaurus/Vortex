import path from "path";

import { fs, log, selectors, types } from "@nexusmods/vortex-api";

import { IGameData, IIncompatibleArchive } from "./types";

const archiveHealthCheckId = "gamebyro-archive-check" as const;

const archiveData: IGameData[] = [
  {
    gameId: "skyrim",
    gameName: "Skyrim (2011)",
    version: [104, 103],
    type: "BSA",
  },
  {
    gameId: "skyrimse",
    gameName: "Skyrim Special Edition",
    version: [105],
    type: "BSA",
  },
  {
    gameId: "skyrimvr",
    gameName: "Skyrim VR",
    version: [105],
    type: "BSA",
  },
  {
    gameId: "oblivion",
    gameName: "Oblivion",
    version: [103],
    type: "BSA",
  },
  {
    gameId: "fallout3",
    gameName: "Fallout 3",
    version: [104],
    type: "BSA",
  },
  {
    gameId: "newvegas",
    gameName: "Fallout New Vegas",
    version: [104],
    type: "BSA",
  },
  {
    gameId: "fallout4",
    gameName: "Fallout 4",
    version: [8, 7, 1],
    type: "BA2",
  },
  {
    gameId: "fallout4vr",
    gameName: "Fallout 4 VR",
    version: [1],
    type: "BA2",
  },
  {
    gameId: "fallout76",
    gameName: "Fallout 76",
    version: [1],
    type: "BA2",
  },
  {
    gameId: "starfield",
    gameName: "Starfield",
    version: [3, 2, 1],
    type: "BA2",
  },
];

type IStateWithPlugins = types.IState & {
  loadOrder: {
    [id: string]: {
      enabled: boolean;
    };
  };
  session: {
    plugins: {
      pluginInfo: {
        [key: string]: {
          id: string;
          name: string;
          isNative: boolean;
          loadsArchive: boolean;
          loadOrder: number;
          modId?: string;
        };
      };
    };
  };
};

export const archiveHealthCheck: types.IHealthCheck = {
  id: archiveHealthCheckId,
  name: "Creation Engine Archive Check",
  description:
    "Checks if any of the mod archives in the loadout are incompatible with the active game.",
  category: types.HealthCheckCategory.Game,
  severity: types.HealthCheckSeverity.Warning,
  triggers: [types.HealthCheckTrigger.Manual, types.HealthCheckTrigger.PluginsChanged],
  // dependencies: [],
  // timeout: 0,
  // cacheDuration: 60000,
  check,
  // fix,
  extensionName: archiveHealthCheckId,
};

function passed(message: string, startedAt: number): types.IHealthCheckResult {
  return {
    checkId: archiveHealthCheckId,
    status: "passed",
    severity: types.HealthCheckSeverity.Info,
    message,
    executionTime: Date.now() - startedAt,
    timestamp: new Date(),
  };
}

function warning(message: string, details: string, startedAt: number): types.IHealthCheckResult {
  return {
    checkId: archiveHealthCheckId,
    status: "warning",
    severity: types.HealthCheckSeverity.Critical,
    message,
    details,
    executionTime: Date.now() - startedAt,
    timestamp: new Date(),
  };
}

async function check(api: types.IExtensionApi): Promise<types.IHealthCheckResult> {
  const startedAt = Date.now();
  const state: IStateWithPlugins = api.getState();
  const pluginInfo = state.session?.plugins?.pluginInfo ?? {};
  const activeGameId = selectors.activeGameId(state);
  const gameData = archiveData.find((g) => g.gameId === activeGameId);
  if (!gameData) {
    return passed(`Game ${activeGameId} does not support archives.`, startedAt);
  }
  if (!pluginInfo || !Object.keys(pluginInfo).length) {
    return passed(`No plugins in load order for ${activeGameId}`, startedAt);
  }

  const plugins = Object.values(pluginInfo).sort((a, b) => (a.loadOrder > b.loadOrder ? 1 : -1));

  const loadOrder = state.loadOrder;

  const archiveLoadingPlugins = plugins.filter(
    (p) => !p.isNative && p.loadsArchive && loadOrder[p.id]?.enabled === true,
  );

  const mods = state.persistent.mods[activeGameId] ?? {};
  const discoveryPath = state.settings.gameMode.discovered[activeGameId]?.path;

  if (!discoveryPath)
    return warning(
      "Game Folder not found",
      `${activeGameId} does not have a discovered game path in Vortex state.`,
      startedAt,
    );

  const dataFolder = discoveryPath ? path.join(discoveryPath, "Data") : undefined;

  try {
    const dataFiles = await fs.readdirAsync(dataFolder);
    const dataArchives = dataFiles.filter((f) => [".ba2", ".bsa"].includes(path.extname(f)));
    const archivesToCheck = archiveLoadingPlugins.flatMap((plugin) => {
      const archives = dataArchives
        .filter((a) => isChildArchiveOfPlugin(a, plugin.name))
        .map((a) => ({ name: a, plugin: plugin.name }));

      console.log("Checking archives for ", plugin.name, archives);

      return archives;
    });

    console.log("Archives to check", { archivesToCheck, dataArchives });

    if (!archivesToCheck.length) return passed("No archives to check", startedAt);

    const issues: IIncompatibleArchive[] = [];

    for (const archive of archivesToCheck) {
      try {
        const version = await streamArchiveVersion(path.join(dataFolder, archive.name));
        // Skip if the archive is compatible
        if (gameData.version.includes(version)) continue;
        const plugin = plugins.find((p) => p.name === archive.plugin);
        const mod = plugin ? mods[plugin.modId] : undefined;
        issues.push({
          name: archive.name,
          version,
          validVersion: gameData.version.join("/"),
          plugin,
          mod,
        });
      } catch (e: unknown) {
        log("warn", `Erroring checking archive version for ${archive.name}`, e);
      }
    }

    // Check if we have any issues now
    if (!issues.length) return passed("No incompatible archives found", startedAt);

    const details = warningDetails(api, issues, gameData);
    const healthCheckWarning = warning("Incompatible mod archive(s)", details, startedAt);
    console.log("Health check completed with warnings", healthCheckWarning);
    return healthCheckWarning;
  } catch (e: unknown) {
    return warning(`Mod Archive checking failed for ${activeGameId}`, String(e), startedAt);
  }
}

async function fix(_: types.IExtensionApi): Promise<void> {}

const isChildArchiveOfPlugin = (fileName: string, pluginName: string): boolean => {
  const normalisedPlugin = pluginName.toLowerCase().normalize("NFC");
  const normalisedFile = path
    .basename(fileName, path.extname(fileName))
    .toLowerCase()
    .normalize("NFC");
  return normalisedPlugin.startsWith(normalisedFile);
};

async function streamArchiveVersion(filePath: string): Promise<number> {
  // Open a stream to the first 9 bytes of the file.
  const stream = fs.createReadStream(filePath, { start: 0, end: 8 });

  return (
    new Promise<number>((resolve, _) => {
      // Create a buffer to house those bytes.
      const data = Buffer.alloc(9);
      stream.on("data", (chunk) => {
        // Fill the buffer.
        data.fill(chunk);
        // Resolve to the archive version number.
        const versionBytes = data.subarray(4, 8);
        const version = versionBytes.reduce((accum, entry) => (accum += entry), 0);
        resolve(version);
      });

      stream.on("error", () => resolve(0));
    })
      // Destroy the file stream.
      .finally(() => stream.destroy())
  );
}

const warningDetails = (
  api: types.IExtensionApi,
  issues: IIncompatibleArchive[],
  gameData: IGameData,
): string => {
  const t = api.translate;
  const thisGame = gameData.gameName;
  // Group the errors by mod
  const groupedErrors: { [id: string]: IIncompatibleArchive[] } = issues.reduce(
    (accum, cur) => {
      if (cur.mod) {
        const modId = cur.mod.id;
        if (accum[modId]) accum[modId].push(cur);
        else accum[modId] = [cur];
      } else {
        accum.noMod.push(cur);
      }
      return accum;
    },
    { noMod: [] },
  );

  // Map the errors into human readible messages
  const textErrors = Object.entries(groupedErrors).map(([key, group]) => {
    if (group.length) return "";
    const mod: Partial<types.IMod> = key !== "noMod" ? group[0].mod : { id: "", attributes: {} };
    const attr = mod.attributes;
    const modName = attr.customName || attr.logicalFileName || attr.name || mod.id;

    const archiveErrors = group.map((a) => {
      const games =
        archiveData
          .filter((g) => g.version.includes(a.version))
          .map((g) => g.gameName)
          .join("/") || t("an unknown game");
      const plugin = a.plugin.name;
      const errMsg = t("Is loaded by {{plugin}}, but is intended for use in {{games}}.", {
        replace: { plugin, games },
      });

      return `${a.name} - ${errMsg}`;
    });

    const groupName = modName ?? t("Not managed by Vortex");

    return `${groupName}: \n-${archiveErrors.join("\n-")}`;
  });

  // Construct the full message
  return (
    t(
      "Some of the archives in your load order are incompatible with {{thisGame}}. " +
        "Using incompatible archives may cause your game to crash on load.",
      { replace: { thisGame } },
    ) +
    textErrors.join("\n") +
    t(
      "You can fix this problem yourself by removing any mods that are not intended to be used with {{thisGame}}. " +
        "If you downloaded these mods from the correct game site at Nexus Mods, you should inform the mod author of this issue. " +
        "Archives for this game must be {{ext}} files (v{{ver}}).",
      {
        replace: {
          thisGame,
          ext: gameData.type,
          ver: gameData.version.join("/"),
        },
      },
    )
  );
};
