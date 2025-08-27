import { useEffect, useMemo, useState, useCallback } from "react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./App.css";

// Create a red target (bullseye) SVG icon as a data URL
const targetIconUrl = (() => {
  const svg = `
    <svg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 28 28' >
      <defs>
        <filter id='shadow' x='-50%' y='-50%' width='200%' height='200%'>
          <feDropShadow dx='0' dy='1' stdDeviation='1' flood-color='rgba(0,0,0,0.35)'/>
        </filter>
      </defs>
      <g filter='url(#shadow)'>
        <circle cx='14' cy='14' r='8' fill='#c8a558' stroke='#1f3457' stroke-width='2'/>
        <circle cx='14' cy='14' r='3' fill='#1f3457'/>
      </g>
    </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
})();

const targetIcon = L.icon({
  iconUrl: targetIconUrl,
  iconSize: [28, 28],
  iconAnchor: [14, 14],
  popupAnchor: [0, -14],
});

function App() {
  const [ranges, setRanges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Helpers to avoid timezone off-by-one issues when formatting dates
  const formatDateLocal = (date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };

  const parseLocalDate = (dateStr) => {
    const [y, m, d] = (dateStr || "").split("-").map((n) => parseInt(n, 10));
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
  };

  const generateStevnerForRange = useCallback((range, index) => {
    if (index % 2 !== 0) return [];
    const baseNames = [
      "Banestevne",
      "Kretsstevne",
      "Treningskveld",
      "Klubbmesterskap",
    ];
    const count = 1 + ((range.skytterlag_id.charCodeAt(0) + index) % 2);
    const events = [];
    const today = new Date();
    for (let i = 0; i < count; i++) {
      const name = `${baseNames[(index + i) % baseNames.length]}`;
      const maxAttendees = 40 + ((index + i) % 4) * 20; // 40, 60, 80, 100
      const rsvpOpen = (index + i) % 3 !== 0; // roughly 2/3 open
      const attendees = rsvpOpen
        ? 10 + ((index * 7 + i * 13) % (maxAttendees - 10))
        : 1 + ((index * 5 + i * 11) % maxAttendees);
      const dayOffset = 3 + ((index * 5 + i * 17) % 120); // 3..122 days in future
      const d = new Date(today);
      d.setDate(today.getDate() + dayOffset);
      const date = formatDateLocal(d); // YYYY-MM-DD local
      events.push({
        id: `${range.skytterlag_id}-${i}`,
        name,
        rsvpOpen,
        attendees: Math.min(attendees, maxAttendees),
        maxAttendees,
        date,
      });
    }
    return events;
  }, []);

  useEffect(() => {
    fetch("/shooting-range-data.json")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load data");
        return res.json();
      })
      .then((data) => {
        const withCoords = Array.isArray(data)
          ? data.filter(
              (d) =>
                typeof d.lat === "number" &&
                typeof d.long === "number" &&
                d.lat !== 0 &&
                d.long !== 0 &&
                d.lat > 50 &&
                d.lat < 90 &&
                d.long > -180 &&
                d.long < 180
            )
          : [];
        const withStevner = withCoords.map((r, idx) => ({
          ...r,
          stevner:
            Array.isArray(r.stevner) && r.stevner.length > 0
              ? r.stevner
              : generateStevnerForRange(r, idx),
        }));
        setRanges(withStevner);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [generateStevnerForRange]);

  const mapCenter = useMemo(() => [64.5, 11], []);
  const mapBounds = useMemo(
    () => [
      [57.5, 3.0],
      [71.5, 33.0],
    ],
    []
  );

  const isEventWithinRange = useCallback(
    (dateStr) => {
      if (!startDate && !endDate) return true;
      if (!dateStr) return false;
      const d = parseLocalDate(dateStr);
      if (Number.isNaN(d.getTime())) return false;
      if (startDate) {
        const s = parseLocalDate(startDate);
        if (d < s) return false;
      }
      if (endDate) {
        const e = parseLocalDate(endDate);
        e.setHours(23, 59, 59, 999);
        if (d > e) return false;
      }
      return true;
    },
    [startDate, endDate]
  );

  const visibleRanges = useMemo(() => {
    if (!startDate && !endDate) return ranges;
    return ranges.filter(
      (r) =>
        Array.isArray(r.stevner) &&
        r.stevner.some((ev) => isEventWithinRange(ev.date))
    );
  }, [ranges, startDate, endDate, isEventWithinRange]);

  if (loading) {
    return <div style={{ padding: 16 }}>Laster skytebaner…</div>;
  }

  if (error) {
    return <div style={{ padding: 16 }}>Feil ved lasting: {error}</div>;
  }

  return (
    <div style={{ height: "100vh", width: "100%", position: "relative" }}>
      <div
        style={{
          position: "absolute",
          top: 12,
          right: 12,
          zIndex: 1000,
          background: "rgba(255,255,255,0.95)",
          borderRadius: 8,
          boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
          fontSize: 14,
          display: "flex",
          flexDirection: "column",
          alignItems: "stretch",
          gap: 8,
        }}
      >
        <button
          onClick={() => setFiltersOpen((v) => !v)}
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 8,
            padding: "12px 16px",
            borderRadius: 6,
            cursor: "pointer",
            fontWeight: 600,
            outline: "none",
            boxShadow: "none",
            WebkitTapHighlightColor: "transparent",
          }}
        >
          <span>Filtrer skytebaner etter kommende stevner</span>
          <span aria-hidden>{filtersOpen ? "▲" : "▼"}</span>
        </button>
        {filtersOpen && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              padding: "2rem",
            }}
          >
            <DayPicker
              mode="range"
              selected={{
                from: startDate ? new Date(startDate) : undefined,
                to: endDate ? new Date(endDate) : undefined,
              }}
              onSelect={(range) => {
                if (!range) {
                  setStartDate("");
                  setEndDate("");
                } else {
                  setStartDate(range.from ? formatDateLocal(range.from) : "");
                  setEndDate(range.to ? formatDateLocal(range.to) : "");
                }
              }}
              captionLayout="buttons"
              weekStartsOn={1}
              footer={
                startDate || endDate ? (
                  <button
                    onClick={() => {
                      setStartDate("");
                      setEndDate("");
                    }}
                  >
                    Nullstill
                  </button>
                ) : null
              }
            />
          </div>
        )}
      </div>
      <MapContainer
        center={mapCenter}
        zoom={5}
        minZoom={3}
        maxBounds={mapBounds}
        maxBoundsViscosity={0.7}
        style={{ height: "100%", width: "100%" }}
        attributionControl={false}
        scrollWheelZoom
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          tileSize={512}
          zoomOffset={-1}
          detectRetina
          className="no-grid-tiles"
        />
        {visibleRanges.map((r) => (
          <Marker
            key={r.skytterlag_id}
            position={[r.lat, r.long]}
            icon={targetIcon}
          >
            <Popup>
              <div style={{ minWidth: 180 }}>
                <div style={{ fontWeight: 600 }}>{r.skytterlag_navn}</div>
                {Array.isArray(r.range_types)
                  ? (() => {
                      const hasInne =
                        r.range_types.includes("SKYTEANLEGG-INNE");
                      const hasUte = r.range_types.includes("SKYTEANLEGG-UTE");
                      const hasFelt = r.range_types.includes("FELTANLEGG");
                      if (!hasInne && !hasUte && !hasFelt) return null;
                      return (
                        <div style={{ marginTop: 8 }}>
                          <div style={{ fontWeight: 500 }}>Anlegg:</div>
                          <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>
                            {hasInne ? <li>Inne</li> : null}
                            {hasUte ? <li>Ute</li> : null}
                            {hasFelt ? <li>Felt</li> : null}
                          </ul>
                        </div>
                      );
                    })()
                  : null}
                {Array.isArray(r.stevner) && r.stevner.length > 0 ? (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontWeight: 500 }}>Stevner:</div>
                    <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>
                      {(startDate || endDate
                        ? r.stevner.filter((ev) => isEventWithinRange(ev.date))
                        : r.stevner
                      ).map((ev) => (
                        <li key={ev.id} style={{ marginBottom: 4 }}>
                          <div>{ev.name}</div>
                          <div style={{ fontSize: 12, color: "#555" }}>
                            Påmelding: {ev.rsvpOpen ? "åpen" : "stengt"} —{" "}
                            {ev.attendees}/{ev.maxAttendees}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <a
                  href={`https://www.google.com/maps/dir/?api=1&origin=Current+Location&destination=${encodeURIComponent(
                    `${r.lat},${r.long}`
                  )}&travelmode=driving`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: "inline-block", marginTop: 8 }}
                >
                  Vis kjørerute
                </a>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}

export default App;
