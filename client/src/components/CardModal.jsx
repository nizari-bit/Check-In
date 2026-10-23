import { useEffect, useState } from "react";
import Modal from "./Modal.jsx";
import { downloadFile, fetchBlob } from "../api.js";

const fileName = (g) =>
  `${g.code}_${
    String(g.full_name || "guest")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/gi, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 40) || "guest"
  }.jpg`;

/** Shows one guest's invitation card (design + their name + their QR) with download and share buttons */
export default function CardModal({ guest, onClose }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    let alive = true;
    let objectUrl = "";
    setUrl("");
    setError("");
    fetchBlob(`/admin/guests/${guest.id}/card.jpg`)
      .then((blob) => {
        if (!alive) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(
        (e) => alive && setError(e.message || "Could not create the card"),
      );
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [guest.id]);

  // On phones this opens the share sheet (WhatsApp, Messages, ...) with the card attached
  const canShare =
    typeof navigator !== "undefined" &&
    !!navigator.canShare &&
    !!navigator.share;
  const share = async () => {
    setSharing(true);
    try {
      const blob = await fetchBlob(`/admin/guests/${guest.id}/card.jpg`);
      const file = new File([blob], fileName(guest), { type: "image/jpeg" });
      if (navigator.canShare({ files: [file] }))
        await navigator.share({
          files: [file],
          title: `Invitation for ${guest.full_name}`,
        });
      else
        await downloadFile(
          `/admin/guests/${guest.id}/card.jpg?download=1`,
          fileName(guest),
        );
    } catch (e) {
      if (e?.name !== "AbortError")
        alert(e.message || "Could not share the card");
    } finally {
      setSharing(false);
    }
  };

  return (
    <Modal title="Invitation card" onClose={onClose}>
      <div
        className="mx-auto w-full max-w-xs overflow-hidden rounded-lg border border-mist bg-mist-50 shadow-sm"
        style={{ aspectRatio: "397 / 559" }}
      >
        {url && (
          <img
            src={url}
            alt={`Invitation card for ${guest.full_name}`}
            className="h-full w-full object-contain"
          />
        )}
        {!url && !error && (
          <div className="flex h-full items-center justify-center text-sm text-steel">
            Creating card…
          </div>
        )}
        {error && (
          <div className="flex h-full items-center justify-center p-4 text-center text-sm text-bad">
            {error}
          </div>
        )}
      </div>

      <div className="mt-3 text-center">
        <p className="font-medium">{guest.full_name}</p>
        <p className="font-mono text-sm font-semibold tracking-widest">
          {guest.code}
        </p>
        <p className="mt-1 text-xs font-bold uppercase tracking-widest text-teal-dark">
          {guest.card_type === "double"
            ? "Double card · admits 2"
            : "Single card · admits 1"}
        </p>
      </div>

      <div className="mt-5 flex flex-wrap justify-end gap-2">
        {canShare && (
          <button
            className="btn btn-secondary"
            disabled={!url || sharing}
            onClick={share}
          >
            {sharing ? "Opening…" : "Share"}
          </button>
        )}
        <button
          className="btn btn-secondary"
          disabled={!url}
          onClick={() =>
            downloadFile(
              `/admin/guests/${guest.id}/card.jpg?download=1`,
              fileName(guest),
            )
          }
        >
          Download JPG
        </button>
        <button className="btn btn-primary" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}
