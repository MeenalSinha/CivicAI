import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { catColor, sevColor } from './ui';

const INV_COLOR = { completed: '#3f8a63', ongoing: '#12406d', tender: '#8a6d00', approved: '#5b6b7c', planned: '#5b6b7c', stalled: '#a4262c' };
const densityColor = (d, max) => { const t = Math.min(1, (d || 0) / (max || 1)); const g = Math.round(235 - t * 150); return `rgb(${Math.round(240 - t * 170)},${g},${Math.round(250 - t * 90)})`; };

/**
 * Layered policy map. All layers are drawn from aggregate data (privacy grid cells, clusters, regions).
 * props: geo (from /policy/geo), layers {requests,hotspots,gaps,density,investments,recommended}, onSelectRegion, focus, mini
 */
export default function PolicyMap({ geo, layers, onSelectRegion, onSelectProject, focus, mini = false, selectedRegionId }) {
  const el = useRef(null), map = useRef(null), group = useRef(null);

  useEffect(() => {
    if (!el.current || map.current) return;
    map.current = L.map(el.current, { zoomControl: true, attributionControl: true }).setView([geo?.center?.lat || 28.62, geo?.center?.lng || 77.22], geo?.center?.zoom || 11);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; OpenStreetMap contributors' }).addTo(map.current);
    group.current = L.layerGroup().addTo(map.current);
    return () => { map.current.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    if (!map.current || !geo) return;
    const g = group.current; g.clearLayers();
    const maxDensity = Math.max(1, ...geo.regions.map(r => r.density || 0));

    if (layers.density) geo.regions.forEach(r => L.circle([r.lat, r.lng], { radius: r.radiusKm * 1000, color: '#6c7f94', weight: 1, fillColor: densityColor(r.density, maxDensity), fillOpacity: 0.55 })
      .bindTooltip(`${r.name}: ${Math.round(r.density).toLocaleString()} people/km²`).addTo(g));

    if (layers.gaps) geo.regions.forEach(r => {
      if (r.gapSeverity == null) return;
      L.circle([r.lat, r.lng], { radius: r.radiusKm * 1000 * 0.95, color: sevColor(r.gapBand), weight: 2, fillColor: sevColor(r.gapBand), fillOpacity: 0.22, dashArray: '5 4' })
        .bindTooltip(`${r.name}: gap severity ${r.gapSeverity} (${r.gapBand})${r.worstSector ? ` — worst: ${r.worstSector.label}` : ''}`).addTo(g);
    });

    if (layers.requests) geo.requestCells.forEach(c => {
      const top = Object.entries(c.categories).sort((a, b) => b[1] - a[1])[0]?.[0];
      L.circleMarker([c.lat, c.lng], { radius: 3 + Math.min(9, Math.sqrt(c.count) * 1.6), color: '#fff', weight: 1, fillColor: catColor(top), fillOpacity: 0.85 })
        .bindTooltip(`${c.count} requests (≈500 m area)`).addTo(g);
    });

    if (layers.hotspots) geo.hotspots.forEach(h => {
      L.circle([h.lat, h.lng], { radius: Math.max(250, h.radiusKm * 1000 + 200), color: catColor(h.category), weight: 2, fillColor: catColor(h.category), fillOpacity: 0.18 })
        .bindTooltip(`<b>${h.categoryLabel}</b><br/>${h.requestCount} requests · ${h.uniqueLocations} locations<br/>≈${Math.round(h.affectedPopulation).toLocaleString()} residents · ${h.region}`).addTo(g);
    });

    if (layers.investments) geo.regions.forEach((r, i) => (r.investments || []).forEach((inv, j) => {
      const ang = (j / Math.max(1, r.investments.length)) * 2 * Math.PI + i, off = 0.004;
      L.marker([r.lat + Math.sin(ang) * off, r.lng + Math.cos(ang) * off], { icon: L.divIcon({ className: '', html: `<div style="width:14px;height:14px;background:${INV_COLOR[inv.stage] || '#5b6b7c'};border:2px solid #fff;transform:rotate(45deg);box-shadow:0 0 0 1px #0f2a43"></div>`, iconSize: [14, 14] }) })
        .bindTooltip(`<b>${inv.name}</b><br/>${inv.stage} · ${inv.budgetFormatted}<br/>covers ${Math.round(inv.share * 100)}% of ${r.name}${inv.isSynthetic ? '<br/><i>synthetic</i>' : ''}`).addTo(g);
    }));

    if (layers.recommended) geo.recommended.forEach(p => {
      if (p.lat == null) return;
      L.marker([p.lat + 0.006, p.lng - 0.006], { icon: L.divIcon({ className: '', html: `<div style="background:#12406d;color:#fff;border:2px solid #fff;border-radius:12px;min-width:24px;height:24px;padding:0 5px;font:700 11px sans-serif;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(0,0,0,.4)">#${p.rank}</div>`, iconSize: [26, 24] }) })
        .bindTooltip(`<b>#${p.rank} ${p.region}</b><br/>${p.categoryLabel} · ${p.priorityScore} (${p.band})`).on('click', () => onSelectProject && onSelectProject(p.id)).addTo(g);
    });

    geo.regions.forEach(r => {
      const isSel = selectedRegionId === r.id;
      L.circle([r.lat, r.lng], { radius: r.radiusKm * 1000, color: isSel ? '#12406d' : '#8fa0b5', weight: isSel ? 3 : 1, fill: true, fillOpacity: 0.01, interactive: true })
        .bindTooltip(r.name, { sticky: true }).on('click', () => onSelectRegion && onSelectRegion(r.id)).addTo(g);
    });
  }, [geo, layers, selectedRegionId, onSelectRegion, onSelectProject]);

  useEffect(() => {
    if (map.current && focus?.lat != null) map.current.setView([focus.lat, focus.lng], focus.zoom || 14, { animate: true });
  }, [focus]);

  return <div ref={el} className={`pi-map ${mini ? 'mini' : ''}`} role="application" aria-label="Interactive map of citizen demand, infrastructure gaps and investments" />;
}
