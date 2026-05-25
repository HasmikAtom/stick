import React, { useState, useEffect, useRef } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "./components/ui/card";
import { Button } from "./components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog";
import { RefreshCw, X, Trash2, Pencil, Check } from "lucide-react";
import { TorrentStatus } from "./Models";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/services";
import { useTorrents } from "@/hooks/useTorrents";

const BYTES_PER_MB = 1024 * 1024;
const BYTES_PER_GB = 1024 * 1024 * 1024;

function formatSize(bytes: number): string {
  if (bytes >= BYTES_PER_GB) {
    return `${(bytes / BYTES_PER_GB).toFixed(2)} GB`;
  }
  return `${(bytes / BYTES_PER_MB).toFixed(2)} MB`;
}

interface Props {
  refreshTrigger?: number;
}

export const TorrentList: React.FC<Props> = React.memo(({ refreshTrigger }) => {
    const { torrents, refresh: fetchTorrents } = useTorrents();
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [editName, setEditName] = useState("");
    const editInputRef = useRef<HTMLInputElement>(null);
    const { toast } = useToast();

    const handleManualRefresh = async () => {
      setIsRefreshing(true);
      await fetchTorrents();
      setIsRefreshing(false);
    };

    const handleDelete = async (id: number, deleteData: boolean) => {
      try {
        const response = await apiFetch(`/api/torrents/${id}?deleteData=${deleteData}`, {
          method: 'DELETE',
        });
        if (response.ok) {
          await fetchTorrents();
          toast({
            title: deleteData ? "Torrent deleted" : "Torrent removed",
            description: deleteData ? "Torrent and files have been deleted" : "Torrent removed from list",
          });
        } else {
          const data = await response.json();
          toast({
            variant: "destructive",
            title: "Delete failed",
            description: data.error || "Could not delete torrent",
          });
        }
      } catch (error) {
        toast({
          variant: "destructive",
          title: "Connection error",
          description: error instanceof Error ? error.message : "Failed to connect to server",
        });
      }
    };

    const handleConfirmDelete = async () => {
      if (deleteConfirmId !== null) {
        await handleDelete(deleteConfirmId, true);
        setDeleteConfirmId(null);
      }
    };

    const startEditing = (torrent: TorrentStatus) => {
      setEditingId(torrent.id);
      setEditName(torrent.name);
      setTimeout(() => editInputRef.current?.focus(), 0);
    };

    const cancelEditing = () => {
      setEditingId(null);
      setEditName("");
    };

    const handleRename = async (id: number) => {
      const trimmed = editName.trim();
      if (!trimmed) {
        cancelEditing();
        return;
      }
      try {
        const response = await apiFetch(`/api/torrents/${id}/rename`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: trimmed }),
        });
        const data = await response.json();
        if (response.ok) {
          toast({ title: "Renamed", description: "Torrent renamed successfully" });
          await fetchTorrents();
        } else {
          toast({
            variant: "destructive",
            title: "Rename failed",
            description: data.error || "Could not rename torrent",
          });
        }
      } catch (error) {
        toast({
          variant: "destructive",
          title: "Connection error",
          description: error instanceof Error ? error.message : "Failed to connect to server",
        });
      }
      cancelEditing();
    };

    useEffect(() => {
      if (refreshTrigger !== undefined) {
        fetchTorrents();
      }
    }, [refreshTrigger, fetchTorrents]);

    return (
      <>
      <Card className="w-full max-w-2xl mx-auto mt-8">
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle>Active Torrents</CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={handleManualRefresh}
              disabled={isRefreshing}
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {torrents && torrents.length > 0 ? (
            <div className="space-y-2">
              {torrents.map((torrent) => (
                <div key={torrent.id} className="rounded-lg border p-3 transition-colors hover:bg-muted/50">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      {editingId === torrent.id ? (
                        <div className="flex items-center gap-1">
                          <input
                            ref={editInputRef}
                            className="flex-1 text-lg font-medium leading-snug bg-transparent border-b border-primary outline-none"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleRename(torrent.id);
                              if (e.key === "Escape") cancelEditing();
                            }}
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => handleRename(torrent.id)}
                            aria-label="Confirm rename"
                          >
                            <Check className="w-4 h-4" />
                          </Button>
                        </div>
                      ) : (
                        <p className="text-lg font-medium leading-snug break-words">{torrent.name}</p>
                      )}
                      <div className="flex flex-wrap items-center gap-1.5 mt-2">
                        <span className="rounded-md bg-muted px-2 py-0.5 text-xs">{torrent.status}</span>
                        <span className="rounded-md bg-muted px-2 py-0.5 text-xs">{formatSize(torrent.totalSize)}</span>
                        <span className="rounded-md bg-muted px-2 py-0.5 text-xs">{torrent.percentDone.toFixed(1)}%</span>
                        {torrent.rateDownload > 0 && (
                          <span className="rounded-md bg-muted px-2 py-0.5 text-xs text-blue-500">
                            {(torrent.rateDownload / BYTES_PER_MB).toFixed(2)} MB/s
                          </span>
                        )}
                        <span className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                          {new Date(torrent.addedDate * 1000).toLocaleDateString()}
                        </span>
                      </div>
                      <div className="mt-2">
                        <div
                          role="progressbar"
                          aria-valuenow={torrent.percentDone}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label={`Download progress for ${torrent.name}`}
                          className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5"
                        >
                          <div
                            className={`h-1.5 rounded-full transition-all duration-300 ${torrent.percentDone >= 100 ? 'bg-green-500' : 'bg-blue-600'}`}
                            style={{ width: `${torrent.percentDone}%` }}
                          />
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => startEditing(torrent)}
                        aria-label={`Rename ${torrent.name}`}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => handleDelete(torrent.id, false)}
                        aria-label={`Remove ${torrent.name} from list`}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => setDeleteConfirmId(torrent.id)}
                        aria-label={`Delete ${torrent.name} and its files`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-center text-gray-500">No active torrents</p>
          )}
        </CardContent>
      </Card>

      <Dialog open={deleteConfirmId !== null} onOpenChange={(open) => !open && setDeleteConfirmId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Torrent and Files</DialogTitle>
            <DialogDescription>
              This will permanently delete the torrent and all downloaded files from your disk. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>
              Cancel
            </Button>
            <Button
              className="bg-slate-700 text-white hover:bg-slate-800"
              onClick={handleConfirmDelete}
            >
              I Understand, Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
    );
  });
