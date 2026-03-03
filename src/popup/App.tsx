import type { JSX } from "react";
import { useEffect, useState } from "react";
import { TAB_GROUP_COLORS } from "@/shared/constants";
import { sendExtensionMessage } from "@/shared/runtime";
import { getDisplayUrl } from "@/shared/url";
import type {
  DuplicateTabCluster,
  FindDuplicateTabsResult,
  MergeAllWindowsResult,
  SessionSnapshot,
} from "@/shared/types";
import "@/ui/base.css";
import "./styles.css";

type StatusTone = "info" | "success" | "error";

interface StatusMessage {
  tone: StatusTone;
  text: string;
}

function getStatusClassName(tone: StatusTone): string {
  return `status-banner status-${tone}`;
}

function getTabLabel(tab: chrome.tabs.Tab): string {
  if (tab.title && tab.title !== tab.pendingUrl) {
    return tab.title;
  }

  return tab.pendingUrl ?? tab.url ?? "Tab sin título";
}

function getTabLocation(tab: chrome.tabs.Tab): string {
  return getDisplayUrl(tab.pendingUrl ?? tab.url);
}

export function App(): JSX.Element {
  const [tabs, setTabs] = useState<chrome.tabs.Tab[]>([]);
  const [selectedTabIds, setSelectedTabIds] = useState<number[]>([]);
  const [groupTitle, setGroupTitle] = useState("");
  const [groupColor, setGroupColor] = useState<chrome.tabGroups.ColorEnum>("blue");
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [isLoadingTabs, setIsLoadingTabs] = useState(true);
  const [isMerging, setIsMerging] = useState(false);
  const [isGrouping, setIsGrouping] = useState(false);
  const [isRestoringLatest, setIsRestoringLatest] = useState(false);
  const [isUndoingMerge, setIsUndoingMerge] = useState(false);
  const [isGroupingByDomain, setIsGroupingByDomain] = useState(false);
  const [isClosingDuplicates, setIsClosingDuplicates] = useState(false);
  const [isScanningDuplicates, setIsScanningDuplicates] = useState(false);
  const [latestSnapshot, setLatestSnapshot] = useState<SessionSnapshot | null>(null);
  const [duplicateSummary, setDuplicateSummary] = useState<FindDuplicateTabsResult | null>(null);

  async function loadTabs(): Promise<void> {
    setIsLoadingTabs(true);

    try {
      const currentTabs = await chrome.tabs.query({ currentWindow: true });
      const highlighted = currentTabs
        .filter((tab) => tab.highlighted && typeof tab.id === "number")
        .map((tab) => tab.id as number);

      setTabs(currentTabs);
      setSelectedTabIds(highlighted.length >= 2 ? highlighted : []);
    } catch (error) {
      setStatus({
        tone: "error",
        text:
          error instanceof Error
            ? error.message
            : "No se pudieron cargar las tabs de la ventana actual.",
      });
    } finally {
      setIsLoadingTabs(false);
    }
  }

  async function loadSnapshotSummary(): Promise<void> {
    try {
      const response = await sendExtensionMessage({ type: "LIST_SNAPSHOTS" });

      if (!response.ok || response.type !== "LIST_SNAPSHOTS_RESULT") {
        throw new Error(response.ok ? "Respuesta inesperada." : response.error);
      }

      setLatestSnapshot(response.data.snapshots[0] ?? null);
    } catch {
      setLatestSnapshot(null);
    }
  }

  async function loadDuplicateSummary(): Promise<void> {
    setIsScanningDuplicates(true);

    try {
      const response = await sendExtensionMessage({ type: "FIND_DUPLICATE_TABS" });

      if (!response.ok || response.type !== "FIND_DUPLICATE_TABS_RESULT") {
        throw new Error(response.ok ? "Respuesta inesperada." : response.error);
      }

      setDuplicateSummary(response.data);
    } catch (error) {
      setStatus({
        tone: "error",
        text:
          error instanceof Error
            ? error.message
            : "No se pudieron analizar las tabs duplicadas.",
      });
    } finally {
      setIsScanningDuplicates(false);
    }
  }

  useEffect(() => {
    void loadTabs();
    void loadSnapshotSummary();
    void loadDuplicateSummary();
  }, []);

  function toggleTab(tabId: number): void {
    setSelectedTabIds((current) =>
      current.includes(tabId)
        ? current.filter((selectedId) => selectedId !== tabId)
        : [...current, tabId],
    );
  }

  async function handleMerge(): Promise<void> {
    setIsMerging(true);
    setStatus({
      tone: "info",
      text: "Consolidando ventanas y guardando snapshot...",
    });

    try {
      const response = await sendExtensionMessage({ type: "MERGE_ALL_WINDOWS" });

      if (!response.ok || response.type !== "MERGE_ALL_WINDOWS_RESULT") {
        throw new Error(response.ok ? "Respuesta inesperada." : response.error);
      }

      setStatus({
        tone: response.data.status === "merged" ? "success" : "info",
        text: buildMergeMessage(response.data),
      });
      await loadTabs();
      await loadSnapshotSummary();
      await loadDuplicateSummary();
    } catch (error) {
      setStatus({
        tone: "error",
        text:
          error instanceof Error
            ? error.message
            : "No se pudieron unir las ventanas.",
      });
    } finally {
      setIsMerging(false);
    }
  }

  async function handleCreateGroup(): Promise<void> {
    const windowId = tabs[0]?.windowId;

    if (typeof windowId !== "number") {
      setStatus({
        tone: "error",
        text: "No se pudo identificar la ventana actual.",
      });
      return;
    }

    setIsGrouping(true);

    try {
      const response = await sendExtensionMessage({
        type: "CREATE_MANUAL_GROUP",
        payload: {
          windowId,
          tabIds: selectedTabIds,
          title: groupTitle,
          color: groupColor,
        },
      });

      if (!response.ok || response.type !== "CREATE_MANUAL_GROUP_RESULT") {
        throw new Error(response.ok ? "Respuesta inesperada." : response.error);
      }

      setStatus({
        tone: "success",
        text: `Grupo "${response.data.title}" creado con ${response.data.tabCount} tabs.`,
      });
      setGroupTitle("");
      await loadTabs();
      await loadDuplicateSummary();
    } catch (error) {
      setStatus({
        tone: "error",
        text:
          error instanceof Error
            ? error.message
            : "No se pudo crear el grupo.",
      });
    } finally {
      setIsGrouping(false);
    }
  }

  async function openDashboard(): Promise<void> {
    await chrome.tabs.create({
      url: chrome.runtime.getURL("dashboard.html"),
    });
  }

  async function handleRestoreLatestSnapshot(): Promise<void> {
    if (!latestSnapshot) {
      return;
    }

    setIsRestoringLatest(true);
    setStatus({
      tone: "info",
      text: "Restaurando el snapshot más reciente...",
    });

    try {
      const response = await sendExtensionMessage({
        type: "RESTORE_SNAPSHOT",
        payload: { snapshotId: latestSnapshot.id },
      });

      if (!response.ok || response.type !== "RESTORE_SNAPSHOT_RESULT") {
        throw new Error(response.ok ? "Respuesta inesperada." : response.error);
      }

      setStatus({
        tone: "success",
        text: `Se restauraron ${response.data.restoredWindows} ventanas y ${response.data.restoredTabs} tabs del último snapshot.`,
      });
    } catch (error) {
      setStatus({
        tone: "error",
        text:
          error instanceof Error
            ? error.message
            : "No se pudo restaurar el último snapshot.",
      });
    } finally {
      setIsRestoringLatest(false);
    }
  }

  async function handleUndoLastMerge(): Promise<void> {
    setIsUndoingMerge(true);
    setStatus({
      tone: "info",
      text: "Intentando deshacer la última consolidación...",
    });

    try {
      const response = await sendExtensionMessage({ type: "UNDO_LAST_MERGE" });

      if (!response.ok || response.type !== "UNDO_LAST_MERGE_RESULT") {
        throw new Error(response.ok ? "Respuesta inesperada." : response.error);
      }

      const message =
        response.data.status === "undone"
          ? `Se deshizo el último merge. Se restauraron ${response.data.restoredWindows} ventanas.`
          : response.data.status === "restored_only"
            ? "Se restauró el snapshot del último merge, pero no se eliminaron las tabs fusionadas porque la ventana cambió desde entonces."
            : "No hay un merge reciente disponible para deshacer.";

      setStatus({
        tone: response.data.status === "undone" ? "success" : "info",
        text: message,
      });

      await loadTabs();
      await loadSnapshotSummary();
      await loadDuplicateSummary();
    } catch (error) {
      setStatus({
        tone: "error",
        text:
          error instanceof Error
            ? error.message
            : "No se pudo deshacer el último merge.",
      });
    } finally {
      setIsUndoingMerge(false);
    }
  }

  async function handleGroupByDomain(): Promise<void> {
    const windowId = tabs[0]?.windowId;

    if (typeof windowId !== "number") {
      setStatus({
        tone: "error",
        text: "No se pudo identificar la ventana actual para agrupar por dominio.",
      });
      return;
    }

    setIsGroupingByDomain(true);
    setStatus({
      tone: "info",
      text: "Agrupando tabs por dominio...",
    });

    try {
      const response = await sendExtensionMessage({
        type: "AUTO_GROUP_BY_DOMAIN",
        payload: {
          scope: "current_window",
          windowId,
        },
      });

      if (!response.ok || response.type !== "AUTO_GROUP_BY_DOMAIN_RESULT") {
        throw new Error(response.ok ? "Respuesta inesperada." : response.error);
      }

      setStatus({
        tone: "success",
        text: `Se crearon ${response.data.createdGroups} grupos automáticos y se agruparon ${response.data.groupedTabs} tabs.`,
      });
      await loadTabs();
      await loadDuplicateSummary();
    } catch (error) {
      setStatus({
        tone: "error",
        text:
          error instanceof Error
            ? error.message
            : "No se pudieron agrupar las tabs por dominio.",
      });
    } finally {
      setIsGroupingByDomain(false);
    }
  }

  async function handleCloseDuplicates(): Promise<void> {
    setIsClosingDuplicates(true);
    setStatus({
      tone: "info",
      text: "Cerrando tabs duplicadas...",
    });

    try {
      const response = await sendExtensionMessage({ type: "CLOSE_DUPLICATE_TABS" });

      if (!response.ok || response.type !== "CLOSE_DUPLICATE_TABS_RESULT") {
        throw new Error(response.ok ? "Respuesta inesperada." : response.error);
      }

      setStatus({
        tone: "success",
        text: `Se cerraron ${response.data.closedTabCount} tabs duplicadas en ${response.data.clusterCount} clusters.`,
      });
      await loadTabs();
      await loadDuplicateSummary();
    } catch (error) {
      setStatus({
        tone: "error",
        text:
          error instanceof Error
            ? error.message
            : "No se pudieron cerrar las tabs duplicadas.",
      });
    } finally {
      setIsClosingDuplicates(false);
    }
  }

  return (
    <main className="popup-shell">
      <section className="panel popup-card" data-testid="popup-root">
        <header className="popup-header">
          <span className="eyebrow">Workspace control</span>
          <h1 className="popup-title">Tab Fusion</h1>
          <p className="popup-subtitle">
            Une ventanas en un click y arma grupos manuales sin perder contexto.
          </p>
        </header>

        <div className="stack">
          {status ? <div className={getStatusClassName(status.tone)}>{status.text}</div> : null}

          <div className="cta-grid">
            <button
              className="primary-button"
              data-testid="merge-all-button"
              onClick={() => void handleMerge()}
              disabled={isMerging}
              type="button"
            >
              {isMerging ? "Uniendo..." : "Unir todas las ventanas"}
            </button>
            <button
              className="secondary-button"
              data-testid="open-dashboard-button"
              onClick={() => void openDashboard()}
              type="button"
            >
              Abrir dashboard
            </button>
            <button
              className="secondary-button"
              data-testid="restore-latest-button"
              disabled={!latestSnapshot || isRestoringLatest}
              onClick={() => void handleRestoreLatestSnapshot()}
              type="button"
            >
              {isRestoringLatest ? "Restaurando..." : "Restaurar último snapshot"}
            </button>
            <button
              className="secondary-button"
              data-testid="undo-last-merge-button"
              disabled={isUndoingMerge}
              onClick={() => void handleUndoLastMerge()}
              type="button"
            >
              {isUndoingMerge ? "Deshaciendo..." : "Deshacer último merge"}
            </button>
          </div>

          <div className={getStatusClassName("info")} data-testid="snapshot-summary">
            {latestSnapshot
              ? `Último snapshot: ${new Date(latestSnapshot.createdAt).toLocaleString("es-ES")} con ${latestSnapshot.tabCount} tabs.`
              : "Todavía no hay snapshots guardados."}
          </div>

          <section className="section">
            <h2 className="section-title">Automatizaciones</h2>
            <p className="section-copy">
              Agrupa por dominio y limpia duplicadas sin salir del popup.
            </p>
            <div className="cta-grid">
              <button
                className="secondary-button"
                data-testid="group-by-domain-button"
                disabled={isGroupingByDomain}
                onClick={() => void handleGroupByDomain()}
                type="button"
              >
                {isGroupingByDomain ? "Agrupando..." : "Agrupar por dominio"}
              </button>
              <button
                className="secondary-button"
                data-testid="scan-duplicates-button"
                disabled={isScanningDuplicates}
                onClick={() => void loadDuplicateSummary()}
                type="button"
              >
                {isScanningDuplicates ? "Analizando..." : "Analizar duplicadas"}
              </button>
              <button
                className="secondary-button"
                data-testid="close-duplicates-button"
                disabled={
                  isClosingDuplicates ||
                  isScanningDuplicates ||
                  !duplicateSummary ||
                  duplicateSummary.duplicateTabCount === 0
                }
                onClick={() => void handleCloseDuplicates()}
                type="button"
              >
                {isClosingDuplicates ? "Cerrando..." : "Cerrar duplicadas"}
              </button>
            </div>
            <div className={getStatusClassName("info")} data-testid="duplicates-summary">
              {duplicateSummary ? buildDuplicateSummaryText(duplicateSummary) : "Sin análisis de duplicadas."}
            </div>
            {duplicateSummary && duplicateSummary.clusters.length > 0 ? (
              <div className="duplicate-cluster-list">
                {duplicateSummary.clusters.slice(0, 3).map((cluster) => (
                  <div className="duplicate-cluster-item" key={cluster.normalizedUrl}>
                    <strong>{cluster.displayUrl}</strong>
                    <span>{cluster.tabCount} tabs</span>
                  </div>
                ))}
              </div>
            ) : null}
          </section>

          <section className="section">
            <h2 className="section-title">Crear grupo manual</h2>
            <p className="section-copy">
              Usa las tabs seleccionadas de esta ventana o marca manualmente las que quieras agrupar.
            </p>

            <div className="field-grid">
              <div className="field">
                <label htmlFor="group-title">Nombre del grupo</label>
                <input
                  data-testid="group-title-input"
                  id="group-title"
                  onChange={(event) => setGroupTitle(event.target.value)}
                  placeholder="Ej: Sprint actual"
                  type="text"
                  value={groupTitle}
                />
              </div>

              <div className="field">
                <label htmlFor="group-color">Color</label>
                <select
                  data-testid="group-color-select"
                  id="group-color"
                  onChange={(event) =>
                    setGroupColor(event.target.value as chrome.tabGroups.ColorEnum)
                  }
                  value={groupColor}
                >
                  {TAB_GROUP_COLORS.map((color) => (
                    <option key={color} value={color}>
                      {color}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label>Tabs de la ventana actual</label>
                <div className="tab-list" role="list">
                  {isLoadingTabs ? (
                    <div className={getStatusClassName("info")}>Cargando tabs...</div>
                  ) : null}

                  {!isLoadingTabs && tabs.length === 0 ? (
                    <div className={getStatusClassName("info")}>
                      No hay tabs disponibles en esta ventana.
                    </div>
                  ) : null}

                  {!isLoadingTabs &&
                    tabs.map((tab) => {
                      const tabId = tab.id;

                      if (typeof tabId !== "number") {
                        return null;
                      }

                      return (
                        <label className="tab-item" data-testid={`tab-item-${tabId}`} key={tabId}>
                          <input
                            data-testid={`tab-checkbox-${tabId}`}
                            checked={selectedTabIds.includes(tabId)}
                            onChange={() => toggleTab(tabId)}
                            type="checkbox"
                          />
                          <div>
                            <p className="tab-title">{getTabLabel(tab)}</p>
                            <p className="tab-url">{getTabLocation(tab)}</p>
                          </div>
                        </label>
                      );
                    })}
                </div>
              </div>

              <button
                className="secondary-button"
                data-testid="create-group-button"
                disabled={isGrouping || selectedTabIds.length < 2 || !groupTitle.trim()}
                onClick={() => void handleCreateGroup()}
                type="button"
              >
                {isGrouping ? "Agrupando..." : "Crear grupo"}
              </button>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}

function buildMergeMessage(result: MergeAllWindowsResult): string {
  if (result.status === "noop") {
    return "No hay suficientes ventanas normales abiertas para consolidar.";
  }

  return `Se consolidaron ${result.windowsMerged} ventanas y se movieron ${result.tabsMoved} tabs a la ventana activa.`;
}

function buildDuplicateSummaryText(result: FindDuplicateTabsResult): string {
  if (result.duplicateTabCount === 0) {
    return "No se detectaron tabs duplicadas en las ventanas normales.";
  }

  return `Se detectaron ${result.duplicateTabCount} tabs duplicadas distribuidas en ${result.clusterCount} URLs repetidas.`;
}
