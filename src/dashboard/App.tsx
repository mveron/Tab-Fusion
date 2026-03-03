import type { JSX } from "react";
import { useEffect, useState } from "react";
import { sendExtensionMessage } from "@/shared/runtime";
import { getDisplayUrl } from "@/shared/url";
import type { SessionSnapshot } from "@/shared/types";
import "@/ui/base.css";
import "@/popup/styles.css";
import "./styles.css";

interface StatusMessage {
  tone: "info" | "success" | "error";
  text: string;
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("es-ES", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function App(): JSX.Element {
  const [snapshots, setSnapshots] = useState<SessionSnapshot[]>([]);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeSnapshotId, setActiveSnapshotId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [isImporting, setIsImporting] = useState(false);

  async function loadSnapshots(): Promise<void> {
    setIsLoading(true);

    try {
      const response = await sendExtensionMessage({ type: "LIST_SNAPSHOTS" });

      if (!response.ok || response.type !== "LIST_SNAPSHOTS_RESULT") {
        throw new Error(response.ok ? "Respuesta inesperada." : response.error);
      }

      setSnapshots(response.data.snapshots);
    } catch (error) {
      setStatus({
        tone: "error",
        text:
          error instanceof Error
            ? error.message
            : "No se pudo cargar el historial.",
      });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadSnapshots();
  }, []);

  const normalizedQuery = query.trim().toLowerCase();
  const filteredSnapshots = snapshots.filter((snapshot) => {
    if (!normalizedQuery) {
      return true;
    }

    return snapshot.windows.some((windowSnapshot) =>
      windowSnapshot.tabs.some((tab) => {
        const haystack = `${tab.title} ${tab.url ?? ""}`.toLowerCase();
        return haystack.includes(normalizedQuery);
      }),
    );
  });

  async function handleRestore(snapshotId: string): Promise<void> {
    setActiveSnapshotId(snapshotId);
    setStatus({
      tone: "info",
      text: "Restaurando snapshot en nuevas ventanas...",
    });

    try {
      const response = await sendExtensionMessage({
        type: "RESTORE_SNAPSHOT",
        payload: { snapshotId },
      });

      if (!response.ok || response.type !== "RESTORE_SNAPSHOT_RESULT") {
        throw new Error(response.ok ? "Respuesta inesperada." : response.error);
      }

      const skippedLabel =
        response.data.skipped.length > 0
          ? ` ${response.data.skipped.length} tabs no se pudieron reabrir.`
          : "";

      setStatus({
        tone: "success",
        text: `Se restauraron ${response.data.restoredWindows} ventanas y ${response.data.restoredTabs} tabs.${skippedLabel}`,
      });
    } catch (error) {
      setStatus({
        tone: "error",
        text:
          error instanceof Error
            ? error.message
            : "No se pudo restaurar el snapshot.",
      });
    } finally {
      setActiveSnapshotId(null);
    }
  }

  async function handleDelete(snapshotId: string): Promise<void> {
    setActiveSnapshotId(snapshotId);

    try {
      const response = await sendExtensionMessage({
        type: "DELETE_SNAPSHOT",
        payload: { snapshotId },
      });

      if (!response.ok || response.type !== "DELETE_SNAPSHOT_RESULT") {
        throw new Error(response.ok ? "Respuesta inesperada." : response.error);
      }

      setSnapshots((current) =>
        current.filter((snapshot) => snapshot.id !== response.data.snapshotId),
      );
      setStatus({
        tone: "success",
        text: "Snapshot eliminado del historial.",
      });
    } catch (error) {
      setStatus({
        tone: "error",
        text:
          error instanceof Error
            ? error.message
            : "No se pudo eliminar el snapshot.",
      });
    } finally {
      setActiveSnapshotId(null);
    }
  }

  function handleExport(): void {
    const blob = new Blob([JSON.stringify({ snapshots }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `tab-fusion-snapshots-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function handleImport(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    setIsImporting(true);

    try {
      const content = await file.text();
      const parsed = JSON.parse(content) as { snapshots?: SessionSnapshot[] } | SessionSnapshot[];
      const snapshotsToImport = Array.isArray(parsed) ? parsed : parsed.snapshots ?? [];

      const response = await sendExtensionMessage({
        type: "IMPORT_SNAPSHOTS",
        payload: { snapshots: snapshotsToImport },
      });

      if (!response.ok || response.type !== "IMPORT_SNAPSHOTS_RESULT") {
        throw new Error(response.ok ? "Respuesta inesperada." : response.error);
      }

      setStatus({
        tone: "success",
        text: `Se importaron ${response.data.importedCount} snapshots. ${response.data.skippedCount} se omitieron.`,
      });
      await loadSnapshots();
    } catch (error) {
      setStatus({
        tone: "error",
        text:
          error instanceof Error
            ? error.message
            : "No se pudieron importar snapshots.",
      });
    } finally {
      event.target.value = "";
      setIsImporting(false);
    }
  }

  return (
    <main className="dashboard-shell">
      <div className="dashboard-layout">
        <section className="panel dashboard-hero">
          <span className="eyebrow">Session history</span>
          <h1 className="dashboard-title">Snapshots restaurables de Tab Fusion</h1>
          <p className="dashboard-copy">
            Cada consolidación de ventanas guarda una foto exacta del contexto para revisarlo o reconstruirlo más tarde.
          </p>
        </section>

        {status ? <div className={`status-banner status-${status.tone}`}>{status.text}</div> : null}

        <section className="dashboard-grid">
          <div className="panel snapshot-card">
            <div className="toolbar-grid">
              <div className="field">
                <label htmlFor="snapshot-search">Buscar actividad por título o URL</label>
                <input
                  data-testid="dashboard-search"
                  id="snapshot-search"
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Ej: github, docs, sprint"
                  type="search"
                  value={query}
                />
              </div>
              <div className="toolbar-actions">
                <button
                  className="secondary-button"
                  data-testid="export-snapshots-button"
                  disabled={snapshots.length === 0}
                  onClick={() => handleExport()}
                  type="button"
                >
                  Exportar JSON
                </button>
                <label className="secondary-button file-button">
                  {isImporting ? "Importando..." : "Importar JSON"}
                  <input
                    accept="application/json"
                    data-testid="import-snapshots-input"
                    disabled={isImporting}
                    onChange={(event) => void handleImport(event)}
                    type="file"
                  />
                </label>
              </div>
            </div>
          </div>

          {isLoading ? <div className="panel dashboard-empty">Cargando historial...</div> : null}

          {!isLoading && snapshots.length === 0 ? (
            <div className="panel dashboard-empty">
              Todavía no hay snapshots guardados. Ejecuta “Unir todas las ventanas” desde el popup para generar el primero.
            </div>
          ) : null}

          {!isLoading && snapshots.length > 0 && filteredSnapshots.length === 0 ? (
            <div className="panel dashboard-empty">No hay resultados para esa búsqueda.</div>
          ) : null}

          {!isLoading &&
            filteredSnapshots.map((snapshot) => (
              <article className="panel snapshot-card" data-testid="snapshot-card" key={snapshot.id}>
                <div className="snapshot-meta">
                  <span className="meta-pill">{formatTimestamp(snapshot.createdAt)}</span>
                  <span className="meta-pill">{snapshot.windowCount} ventanas</span>
                  <span className="meta-pill">{snapshot.tabCount} tabs</span>
                </div>

                <h2 className="snapshot-title">Snapshot {snapshot.id.slice(0, 8)}</h2>

                <div className="window-grid">
                  {snapshot.windows.map((windowSnapshot, index) => (
                    <div className="window-card" key={`${snapshot.id}-${windowSnapshot.originalWindowId}`}>
                      <h3>Ventana {index + 1}</h3>
                      <ul>
                        {windowSnapshot.tabs.slice(0, 4).map((tab) => (
                          <li key={`${tab.index}-${tab.title}`}>
                            <strong>{tab.title}</strong>
                            <br />
                            {getDisplayUrl(tab.url)}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>

                <div className="snapshot-actions">
                  <button
                    className="primary-button"
                    data-testid={`restore-snapshot-${snapshot.id}`}
                    disabled={activeSnapshotId === snapshot.id}
                    onClick={() => void handleRestore(snapshot.id)}
                    type="button"
                  >
                    {activeSnapshotId === snapshot.id ? "Procesando..." : "Restaurar"}
                  </button>
                  <button
                    className="secondary-button"
                    data-testid={`delete-snapshot-${snapshot.id}`}
                    disabled={activeSnapshotId === snapshot.id}
                    onClick={() => void handleDelete(snapshot.id)}
                    type="button"
                  >
                    Eliminar
                  </button>
                </div>
              </article>
            ))}
        </section>
      </div>
    </main>
  );
}
