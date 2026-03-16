import { useState, useEffect, useRef } from 'react'
import { MapContainer, TileLayer, CircleMarker, Tooltip, useMap } from 'react-leaflet'
import { jsPDF } from 'jspdf'
import { cacheGet, cacheSet, cacheClear } from './cache.js'
import 'leaflet/dist/leaflet.css'

const E_URL    = 'https://data.cityofnewyork.us/resource/hxm3-23vy.json'
const PLUTO_URL = 'https://data.cityofnewyork.us/resource/64uk-42ks.json'
const OER_URL  = 'https://data.cityofnewyork.us/resource/3279-pp7v.json'
const CACHE_KEY = 'edesig_v5'

const BOROUGHS = { '1': 'Manhattan', '2': 'Bronx', '3': 'Brooklyn', '4': 'Queens', '5': 'Staten Island' }

const OER_PROGRAMS = {
  'VCP': { label: 'Voluntary Cleanup Program (VCP)', desc: 'Site is enrolled in NYC OER\'s Voluntary Cleanup Program. The responsible party has agreed to investigate and remediate contamination under OER oversight in exchange for liability protection upon successful completion.' },
  'E/RD': { label: 'Environmental Review / Remedial Design', desc: 'Site is under Environmental Review and/or Remedial Design. OER is reviewing submitted environmental reports and remedial action plans to ensure contamination is adequately characterized and the proposed cleanup is protective of public health.' },
  'State BCP': { label: 'NY State Brownfield Cleanup Program (BCP)', desc: 'Site is enrolled in the NYS DEC Brownfield Cleanup Program, which provides tax credits and liability relief upon completion of remediation to applicable cleanup standards.' },
  'City': { label: 'City-Managed Remediation', desc: 'Site is being remediated under direct City of New York management, typically due to an imminent public health threat or absence of a viable responsible party.' },
}

const OER_PHASES = {
  'Approved Remedial Plan': 'A Remedial Action Plan (RAP) has been reviewed and approved by OER. Remediation activities are either pending or underway.',
  'Remedial Investigation': 'A Remedial Investigation (RI) is underway to characterize the nature and extent of contamination at the site.',
  'Site Management': 'Active remediation is complete. The site is in an ongoing Site Management phase, which may include long-term monitoring, institutional controls, or engineering controls.',
  'Closure': 'Remediation is substantially complete. The responsible party has submitted or is preparing a Closure Report for OER review and approval.',
  'Completed': 'OER has issued a Notice of Satisfaction or Certificate of Completion. All required remedial actions have been performed to the applicable cleanup standards.',
}

function edesigColor(site) {
  if (isTrue(site.hazmat_code)) return '#e74c3c'
  if (isTrue(site.air_code))    return '#e67e22'
  if (isTrue(site.noise_code))  return '#3498db'
  return '#888'
}

function oerColor(site) {
  return site.class?.includes('Active') ? '#9b59b6' : '#16a085'
}

function isTrue(v) { return v === true || v === 'true' }

function fmt(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

function hexToRgb(hex) {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

function buildNarrative(site, borough) {
  const paras = []
  const date  = fmt(site.effective_date)
  paras.push(`This property (BBL: ${site.bbl}), located in ${borough}, carries an Environmental (E) Designation pursuant to the NYC Environmental Quality Review (CEQR) process. E-Designation ${site.enumber} was established on ${date} under CEQR Number ${site.ceqr_num || 'N/A'} and ULURP Number ${site.ulurp_num || 'N/A'}. The E-Designation runs with the land and must be resolved prior to the issuance of any building permit.`)
  if (site.description) {
    paras.push(`The specific environmental condition identified for this lot is: "${site.description}." This condition was identified during the CEQR environmental review process associated with a rezoning or other discretionary land use action affecting this property or its vicinity.`)
  }
  if (isTrue(site.hazmat_code)) {
    const rem = site.hazmat_date ? ` The hazardous materials component was remediated as of ${fmt(site.hazmat_date)}.` : ''
    paras.push(`Hazardous Materials Designation: A Phase I/II Environmental Site Assessment (ESA) is required prior to development. This designation is typically triggered by the presence or suspected presence of petroleum products, hazardous substances, or a history of industrial land use on or adjacent to the lot. If Recognized Environmental Conditions (RECs) are identified in the Phase I, a Phase II ESA involving subsurface investigation is required. Any confirmed contamination must be remediated under a Remedial Action Plan (RAP) approved by NYC OER or NYSDEC prior to permit issuance.${rem}`)
  }
  if (isTrue(site.air_code)) {
    const rem = site.air_date ? ` The air quality component was satisfied as of ${fmt(site.air_date)}.` : ''
    paras.push(`Air Quality Designation: A detailed air quality analysis is required to assess potential impacts on future building occupants from nearby stationary or mobile emission sources. Where impacts are identified, mitigation — such as high-efficiency air filtration, sealed facades, or alternate mechanical ventilation — must be incorporated into the building design and approved prior to permit issuance.${rem}`)
  }
  if (isTrue(site.noise_code)) {
    const rem = site.noise_date ? ` The noise component was satisfied as of ${fmt(site.noise_date)}.` : ''
    paras.push(`Noise Designation: A noise analysis is required to demonstrate that future occupants will not be exposed to interior noise levels exceeding 45 dBA (Ldn) in residential sleeping areas or 50 dBA (Ldn) in other habitable spaces. Required mitigation typically includes upgraded window glazing assemblies, solid exterior wall construction, and alternate means of ventilation per CEQR Technical Manual standards.${rem}`)
  }
  return paras
}

function buildMarketingContent(edesig, oer) {
  const hasHazmat = edesig && isTrue(edesig.hazmat_code)
  const hasAir    = edesig && isTrue(edesig.air_code)
  const hasNoise  = edesig && isTrue(edesig.noise_code)
  const hazmatRem = edesig?.hazmat_date
  const airRem    = edesig?.air_date
  const noiseRem  = edesig?.noise_date

  const activeHazmat = hasHazmat && !hazmatRem
  const activeAir    = hasAir    && !airRem
  const activeNoise  = hasNoise  && !noiseRem
  const anyActiveEdesig = activeHazmat || activeAir || activeNoise
  const allEdesigRemediated = edesig && !anyActiveEdesig

  const oerActive    = oer && oer.class?.includes('Active')
  const oerCompleted = oer && !oerActive
  const oerPhase     = oer?.phase || ''
  const oerPrograms  = oer?.oer_program?.split(',').map(p => p.trim()) || []
  const isVCP        = oerPrograms.some(p => p.includes('VCP'))
  const isBCP        = oerPrograms.some(p => p.includes('BCP'))

  const services = []
  const audiences = []

  // Active E-designation services
  if (activeHazmat) {
    services.push('Phase I/II Environmental Site Assessment (ESA)')
    services.push('Remedial Action Plan (RAP) preparation and OER/NYSDEC submission')
    services.push('NYC OER Voluntary Cleanup Program (VCP) enrollment and oversight')
    audiences.push('developers and owners who need to satisfy the hazardous materials E-Designation before a building permit can be issued')
  }
  if (activeAir) {
    services.push('CEQR air quality analysis and impact modeling')
    services.push('Mitigation design — filtration systems, sealed facades, and alternate ventilation specifications')
    audiences.push('developers who need air quality mitigation measures approved by OER as a condition of permit')
  }
  if (activeNoise) {
    services.push('CEQR noise impact analysis to 45/50 dBA (Ldn) interior standards')
    services.push('Noise attenuation specifications — glazing, wall assemblies, and HVAC systems')
    audiences.push('developers who must demonstrate noise compliance under CEQR Technical Manual standards before receiving a building permit')
  }

  // Remediated E-designation services
  if (allEdesigRemediated) {
    services.push('CEQR compliance verification and E-Designation closure documentation')
    audiences.push('owners and developers confirming that prior E-Designation requirements have been fully satisfied')
  }

  // Active OER services
  if (oerActive) {
    if (oerPhase.includes('Remedial Investigation')) {
      services.push('Remedial Investigation (RI) oversight and quality assurance')
      services.push('Sampling program design and laboratory data review')
      audiences.push('responsible parties and developers engaged in or overseeing the active site investigation')
    }
    if (oerPhase.includes('Approved Remedial Plan')) {
      services.push('Remedial Action Plan implementation oversight and contractor management')
      services.push('Construction quality assurance and health and safety plan (HASP) preparation')
      audiences.push('property owners and developers managing active soil or groundwater remediation')
    }
    if (oerPhase.includes('Site Management')) {
      services.push('Long-term monitoring program design and institutional/engineering controls review')
      services.push('Land Use Control (LUC) covenant compliance monitoring')
      audiences.push('owners managing post-remediation site conditions and institutional control obligations')
    }
    if (oerPhase.includes('Closure')) {
      services.push('Closure Report preparation and OER submission')
      services.push('Certificate of Completion / Notice of Satisfaction support')
      audiences.push('responsible parties approaching the finish line of the remediation program')
    }
    if (isVCP) services.push('NYC OER Voluntary Cleanup Program (VCP) application, negotiation, and milestone management')
    if (isBCP) services.push('NYS DEC Brownfield Cleanup Program (BCP) enrollment, track selection, and tax credit maximization')
  }

  // Completed OER services
  if (oerCompleted) {
    services.push('Development readiness confirmation and post-remediation due diligence')
    services.push('Review of site management obligations, institutional controls, and deed restrictions')
    audiences.push('prospective purchasers, developers, and lenders conducting environmental due diligence on a remediated property')
  }

  // Fallback for OER-only sites with no clear phase
  if (oer && services.length === 0) {
    services.push('Environmental due diligence and Phase I/II ESA')
    services.push('NYC OER program advisory and coordination services')
    audiences.push('owners, developers, and prospective purchasers evaluating environmental liability at this OER-listed site')
  }

  // Generic fallback
  if (services.length === 0) {
    services.push('Phase I/II Environmental Site Assessment (ESA)')
    services.push('E-Designation compliance consulting and CEQR review support')
    audiences.push('owners, developers, and prospective purchasers navigating NYC environmental requirements')
  }

  // Build headline
  let headline = 'Environmental Services for This Site'
  if (edesig && oer) {
    headline = anyActiveEdesig ? 'Active E-Designation + OER Site — Let Impact Environmental Clear the Path' : 'E-Designation & OER Site — Confirm Compliance, Accelerate Development'
  } else if (edesig && anyActiveEdesig) {
    headline = 'Active E-Designation — Impact Environmental Can Get You to Permit'
  } else if (edesig && allEdesigRemediated) {
    headline = 'Remediated E-Designation — Verify Compliance and Move Forward'
  } else if (oer && oerCompleted) {
    headline = 'Remediation Complete — Due Diligence and Development Services Available'
  } else if (oer && oerActive) {
    headline = 'Active OER Remediation — Advisory and Oversight Services Available'
  }

  // Build body
  const audienceStr = audiences.length > 0
    ? `This site represents a specific opportunity for ${audiences[0]}.`
    : 'This site presents environmental compliance requirements that Impact Environmental is positioned to address.'

  const serviceList = [...new Set(services)].slice(0, 5).map(s => `• ${s}`).join('  ')

  const body = `${audienceStr} Impact Environmental provides the following services directly relevant to this site: ${serviceList}. Our licensed professionals have successfully guided projects through the NYC OER, NYSDEC, and CEQR processes across all five boroughs — turning environmental obligations into development-ready outcomes.`

  // Build CTA
  const cta = oerActive
    ? 'Contact Impact Environmental for a site-specific remediation strategy consultation.'
    : anyActiveEdesig
      ? 'Contact Impact Environmental to begin your E-Designation compliance program today.'
      : 'Contact Impact Environmental to confirm site status and support your next transaction or permit application.'

  return { headline, body, cta }
}

async function fetchMapTileImage(lat, lng, markerColor) {
  const ZOOM = 16, TS = 256, G = 3, STRIP_H = 282
  const n = Math.pow(2, ZOOM)
  const latRad = lat * Math.PI / 180
  const tileXf = (lng + 180) / 360 * n
  const tileYf = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n
  const tileX = Math.floor(tileXf)
  const tileY = Math.floor(tileYf)
  const fracX = (tileXf - tileX) * TS
  const fracY = (tileYf - tileY) * TS
  const markerPx = TS + fracX
  const markerPy = TS + fracY

  function loadTile(tx, ty) {
    return new Promise(resolve => {
      const tyc = Math.max(0, Math.min(n - 1, ty))
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => resolve(img)
      img.onerror = () => resolve(null)
      img.src = `https://a.tile.openstreetmap.org/${ZOOM}/${tx}/${tyc}.png`
    })
  }

  const tiles = await Promise.all(
    Array.from({ length: G * G }, (_, i) => {
      const col = i % G, row = Math.floor(i / G)
      return loadTile(tileX + col - 1, tileY + row - 1)
    })
  )

  const canvas = document.createElement('canvas')
  canvas.width = TS * G; canvas.height = TS * G
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#e8e8e8'; ctx.fillRect(0, 0, canvas.width, canvas.height)
  tiles.forEach((img, i) => {
    if (img) ctx.drawImage(img, (i % G) * TS, Math.floor(i / G) * TS)
  })

  // Draw marker
  const [mr, mg, mb] = hexToRgb(markerColor)
  const mx = markerPx, my = markerPy
  // Pulse halo
  ctx.beginPath(); ctx.arc(mx, my, 18, 0, 2 * Math.PI)
  ctx.fillStyle = `rgba(${mr},${mg},${mb},0.22)`; ctx.fill()
  // Filled dot
  ctx.beginPath(); ctx.arc(mx, my, 10, 0, 2 * Math.PI)
  ctx.fillStyle = markerColor; ctx.fill()
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.5; ctx.stroke()
  // Inner white dot
  ctx.beginPath(); ctx.arc(mx, my, 3.5, 0, 2 * Math.PI)
  ctx.fillStyle = '#ffffff'; ctx.fill()

  // Crop to horizontal strip centered on marker
  const cropY = Math.max(0, Math.min(Math.round(markerPy - STRIP_H / 2), TS * G - STRIP_H))
  const out = document.createElement('canvas')
  out.width = TS * G; out.height = STRIP_H
  out.getContext('2d').drawImage(canvas, 0, cropY, TS * G, STRIP_H, 0, 0, TS * G, STRIP_H)
  return out.toDataURL('image/jpeg', 0.88)
}

function Resizer() {
  const map = useMap()
  useEffect(() => { map.invalidateSize() }, [map])
  return null
}

function MapFlyTo({ target }) {
  const map = useMap()
  useEffect(() => {
    if (target) map.flyTo([target.lat, target.lng], 17, { duration: 1.2 })
  }, [target, map])
  return null
}

export default function App() {
  const [edesigSites, setEdesigSites]   = useState([])
  const [oerSites, setOerSites]         = useState([])
  const [oerByBbl, setOerByBbl]         = useState({})
  const [selected, setSelected]         = useState(null)
  const [status, setStatus]             = useState('idle')
  const [message, setMessage]           = useState('')
  const [searchQuery, setSearchQuery]   = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [flyTarget, setFlyTarget]       = useState(null)
  const searchRef = useRef(null)

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    const cached = await cacheGet(CACHE_KEY)
    if (cached?.edesig?.length > 0 && cached?.oer?.length > 0) {
      setEdesigSites(cached.edesig)
      setOerSites(cached.oer)
      buildOerIndex(cached.oer)
      setStatus('done')
      return
    }

    setStatus('loading')

    try {
      // --- E-designations ---
      setMessage('Fetching E-designation records...')
      let edesig = []
      let offset = 0
      while (true) {
        const r = await fetch(`${E_URL}?$limit=1000&$offset=${offset}&$order=bbl`)
        const chunk = await r.json()
        edesig = edesig.concat(chunk)
        if (chunk.length < 1000) break
        offset += 1000
      }

      // --- PLUTO geocoding ---
      setMessage(`Geocoding ${edesig.length} E-designation lots...`)
      const bbls = [...new Set(edesig.map(r => r.bbl).filter(Boolean))]
      const coordMap = {}
      const BATCH = 150
      for (let i = 0; i < bbls.length; i += BATCH) {
        const batch = bbls.slice(i, i + BATCH)
        const inClause = batch.map(b => `'${b}.00000000'`).join(',')
        const url = `${PLUTO_URL}?$select=bbl,latitude,longitude&$where=${encodeURIComponent(`bbl in(${inClause})`)}&$limit=${BATCH}`
        const rows = await (await fetch(url)).json()
        rows.forEach(row => {
          if (row.latitude && row.longitude) {
            coordMap[String(Math.round(parseFloat(row.bbl)))] = {
              lat: parseFloat(row.latitude), lng: parseFloat(row.longitude),
            }
          }
        })
        setMessage(`Geocoded ${Math.min(i + BATCH, bbls.length)} / ${bbls.length} lots...`)
      }
      edesig = edesig.map(s => {
        const c = coordMap[s.bbl]
        return c ? { ...s, lat: c.lat, lng: c.lng } : null
      }).filter(Boolean)

      // --- OER sites ---
      setMessage('Fetching OER cleanup sites...')
      let oer = []
      offset = 0
      while (true) {
        const r = await fetch(`${OER_URL}?$limit=1000&$offset=${offset}&$order=project_name`)
        const chunk = await r.json()
        oer = oer.concat(chunk)
        if (chunk.length < 1000) break
        offset += 1000
      }
      oer = oer.filter(s => s.latitude && s.longitude).map(s => ({
        ...s,
        lat: parseFloat(s.latitude),
        lng: parseFloat(s.longitude),
        epicUrl: s.project_specific_document?.url || null,
      }))

      // Trim to only needed fields before caching
      const edesigTrimmed = edesig.map(({ enumber, effective_date, borocode, taxblock, taxlot, hazmat_code, air_code, noise_code, hazmat_date, air_date, noise_date, ceqr_num, ulurp_num, zoning_map, description, bbl, lat, lng }) =>
        ({ enumber, effective_date, borocode, taxblock, taxlot, hazmat_code, air_code, noise_code, hazmat_date, air_date, noise_date, ceqr_num, ulurp_num, zoning_map, description, bbl, lat, lng }))
      const oerTrimmed = oer.map(({ oer_project_numbers, project_name, street_number, street_name, borough, bbl, oer_program, class: cls, phase, epicUrl, lat, lng, zip_code, community_district, nta_name }) =>
        ({ oer_project_numbers, project_name, street_number, street_name, borough, bbl, oer_program, class: cls, phase, epicUrl, lat, lng, zip_code, community_district, nta_name }))
      await cacheSet(CACHE_KEY, { edesig: edesigTrimmed, oer: oerTrimmed })
      setEdesigSites(edesigTrimmed)
      setOerSites(oerTrimmed)
      buildOerIndex(oerTrimmed)
      setStatus('done')
    } catch (err) {
      setStatus('error')
      setMessage(err.message || String(err))
      console.error('loadAll error:', err)
    }
  }

  function buildOerIndex(oer) {
    const idx = {}
    oer.forEach(site => {
      if (!site.bbl) return
      site.bbl.split(',').map(b => b.trim()).forEach(b => { idx[b] = site })
    })
    setOerByBbl(idx)
  }

  function handleEdesigClick(site) {
    const oer = oerByBbl[site.bbl] || null
    setSelected({ type: oer ? 'both' : 'edesig', edesig: site, oer })
  }

  function handleOerClick(site) {
    setSelected({ type: 'oer', edesig: null, oer: site })
  }

  async function refreshData() {
    await cacheClear()
    setEdesigSites([]); setOerSites([]); setOerByBbl({}); setSelected(null)
    loadAll()
  }

  async function handleSearch(q) {
    setSearchQuery(q)
    if (q.length < 3) { setSearchResults([]); return }
    try {
      const r = await fetch(`https://geosearch.planninglabs.nyc/v2/autocomplete?text=${encodeURIComponent(q)}&size=6`)
      const d = await r.json()
      setSearchResults(d.features || [])
    } catch (_) { setSearchResults([]) }
  }

  function selectResult(f) {
    const [lng, lat] = f.geometry.coordinates
    setFlyTarget({ lat, lng })
    setSearchQuery(f.properties.label)
    setSearchResults([])
  }

  // OER sites that are NOT also E-designated (to avoid double rendering)
  const edesigBbls = new Set(edesigSites.map(s => s.bbl))
  const oerOnlySites = oerSites.filter(s => {
    if (!s.bbl) return true
    return !s.bbl.split(',').some(b => edesigBbls.has(b.trim()))
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', fontFamily: 'system-ui, -apple-system, sans-serif' }}>

      {/* ── Header ── */}
      <div style={{ background: '#1a1a2e', color: '#fff', height: 52, display: 'flex', alignItems: 'center', padding: '0 16px', gap: 12, flexShrink: 0, zIndex: 1000, boxShadow: '0 2px 8px rgba(0,0,0,0.4)' }}>
        <img src="/logo.png" alt="Impact" style={{ height: 34, width: 34, objectFit: 'contain', flexShrink: 0 }} />
        <strong style={{ fontSize: 14, whiteSpace: 'nowrap', letterSpacing: 0.3 }}>NYC Environmental Site Map</strong>
        <div style={{ width: 1, height: 24, background: '#333', flexShrink: 0 }} />

        {/* Search */}
        <div ref={searchRef} style={{ position: 'relative', flex: 1, maxWidth: 400 }}>
          <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(255,255,255,0.08)', borderRadius: 6, border: '1px solid rgba(255,255,255,0.12)', padding: '0 10px' }}>
            <span style={{ color: '#666', fontSize: 12, marginRight: 6 }}>🔍</span>
            <input
              type="text"
              placeholder="Search NYC address..."
              value={searchQuery}
              onChange={e => handleSearch(e.target.value)}
              onKeyDown={e => e.key === 'Escape' && (setSearchQuery(''), setSearchResults([]))}
              style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: '#fff', fontSize: 13, padding: '7px 0' }}
            />
            {searchQuery && <span onClick={() => { setSearchQuery(''); setSearchResults([]) }} style={{ color: '#555', cursor: 'pointer', fontSize: 13 }}>✕</span>}
          </div>
          {searchResults.length > 0 && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', borderRadius: 6, boxShadow: '0 6px 24px rgba(0,0,0,0.18)', zIndex: 2000, marginTop: 4, overflow: 'hidden' }}>
              {searchResults.map((f, i) => (
                <div key={i} onClick={() => selectResult(f)}
                  style={{ padding: '9px 14px', fontSize: 12, color: '#2c3e50', cursor: 'pointer', borderBottom: '1px solid #f0f0f0' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f0f4ff'}
                  onMouseLeave={e => e.currentTarget.style.background = '#fff'}
                >
                  <div style={{ fontWeight: 600 }}>{f.properties.name}</div>
                  <div style={{ color: '#999', fontSize: 11, marginTop: 1 }}>{f.properties.borough || f.properties.region}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          {status === 'done' && (
            <span style={{ fontSize: 11, color: '#666' }}>
              {edesigSites.length.toLocaleString()} E-desig · {oerSites.length.toLocaleString()} OER
            </span>
          )}
          {(status === 'loading' || status === 'error') && <span style={{ fontSize: 11, color: status === 'error' ? '#e74c3c' : '#aaa' }}>{message}</span>}
          {status === 'done' && (
            <button onClick={refreshData} style={{ background: 'none', border: '1px solid #333', color: '#666', padding: '3px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}>
              Refresh
            </button>
          )}
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* ── Map ── */}
        <div style={{ flex: 1, position: 'relative' }}>
          <MapContainer center={[40.72, -73.98]} zoom={11} style={{ position: 'absolute', inset: 0 }}>
            <Resizer />
            <MapFlyTo target={flyTarget} />
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; OpenStreetMap contributors' />

            {/* OER rings — rendered first (behind E-desig dots) */}
            {oerSites.map((site, i) => (
              <CircleMarker key={`oer-${i}`} center={[site.lat, site.lng]} radius={10}
                pathOptions={{ fillColor: oerColor(site), color: oerColor(site), weight: 2, fillOpacity: 0.18, opacity: 0.7 }}
                eventHandlers={{ click: () => handleOerClick(site) }}
              >
                <Tooltip>{site.project_name}</Tooltip>
              </CircleMarker>
            ))}

            {/* E-designation dots — rendered on top */}
            {edesigSites.map((site, i) => (
              <CircleMarker key={`e-${i}`} center={[site.lat, site.lng]} radius={5}
                pathOptions={{
                  fillColor: edesigColor(site),
                  color: selected?.edesig?.bbl === site.bbl ? '#fff' : edesigColor(site),
                  weight: selected?.edesig?.bbl === site.bbl ? 2 : 1,
                  fillOpacity: 0.9,
                }}
                eventHandlers={{ click: () => handleEdesigClick(site) }}
              >
                <Tooltip>{site.enumber}</Tooltip>
              </CircleMarker>
            ))}
          </MapContainer>

          {/* ── Legend ── */}
          {status === 'done' && (
            <div style={{ position: 'absolute', bottom: 24, left: 12, background: '#fff', borderRadius: 8, padding: '12px 16px', boxShadow: '0 2px 12px rgba(0,0,0,0.15)', zIndex: 500, fontSize: 12, minWidth: 180 }}>
              <div style={{ fontWeight: 700, color: '#1a1a2e', marginBottom: 8, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.8 }}>E-Designation Type</div>
              {[['#e74c3c','Hazardous Materials'],['#e67e22','Air Quality'],['#3498db','Noise'],['#888','Other']].map(([c,l]) => (
                <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: c, flexShrink: 0 }} />
                  <span style={{ color: '#444' }}>{l}</span>
                </div>
              ))}
              <div style={{ height: 1, background: '#eee', margin: '10px 0' }} />
              <div style={{ fontWeight: 700, color: '#1a1a2e', marginBottom: 8, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.8 }}>OER Cleanup Sites</div>
              {[['#9b59b6','Active Remediation'],['#16a085','Completed']].map(([c,l]) => (
                <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
                  <div style={{ width: 12, height: 12, borderRadius: '50%', border: `2.5px solid ${c}`, background: c+'30', flexShrink: 0 }} />
                  <span style={{ color: '#444' }}>{l}</span>
                </div>
              ))}
              <div style={{ height: 1, background: '#eee', margin: '10px 0' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <div style={{ position: 'relative', width: 14, height: 14, flexShrink: 0 }}>
                  <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '2.5px solid #9b59b6', background: '#9b59b630' }} />
                  <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 6, height: 6, borderRadius: '50%', background: '#e74c3c' }} />
                </div>
                <span style={{ color: '#444' }}>E-Desig + OER Overlap</span>
              </div>
            </div>
          )}

          {/* Loading overlay */}
          {status === 'loading' && (
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(26,26,46,0.92)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 600 }}>
              <img src="/logo.png" alt="" style={{ width: 56, height: 56, marginBottom: 20, opacity: 0.9 }} />
              <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', marginBottom: 8 }}>Loading Environmental Data</div>
              <div style={{ fontSize: 13, color: '#aaa', marginBottom: 6 }}>{message}</div>
              <div style={{ fontSize: 11, color: '#555', marginTop: 4 }}>First load ~60 sec · Results cached for 24 hours</div>
            </div>
          )}

          {/* Error overlay */}
          {status === 'error' && (
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(26,26,46,0.95)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 600 }}>
              <div style={{ fontSize: 32, marginBottom: 16 }}>⚠️</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 8 }}>Failed to Load Data</div>
              <div style={{ fontSize: 13, color: '#e74c3c', marginBottom: 20, maxWidth: 400, textAlign: 'center' }}>{message}</div>
              <button onClick={refreshData} style={{ padding: '10px 24px', background: '#e74c3c', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Try Again</button>
            </div>
          )}

          {/* Debug status (top-right, small) */}
          {status === 'done' && (
            <div style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.6)', color: '#0f0', fontFamily: 'monospace', fontSize: 10, padding: '5px 10px', borderRadius: 4, zIndex: 500, lineHeight: 1.8 }}>
              E-desig: {edesigSites.length} · OER: {oerSites.length}
            </div>
          )}
        </div>

        {/* ── Side Panel ── */}
        {selected && (
          <div style={{ width: 440, borderLeft: '1px solid #e5e5e5', overflowY: 'auto', background: '#fafafa', flexShrink: 0 }}>
            <SitePanel selected={selected} onClose={() => setSelected(null)} />
          </div>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────
// SITE PANEL
// ─────────────────────────────────────────
function SitePanel({ selected, onClose }) {
  const { type, edesig, oer } = selected
  const borough = edesig ? (BOROUGHS[String(edesig.borocode)] || '—') : (oer?.borough || '—')

  const eTypes = edesig ? [
    { key: 'hazmat', label: 'Hazardous Materials', color: '#e74c3c' },
    { key: 'air',    label: 'Air Quality',          color: '#e67e22' },
    { key: 'noise',  label: 'Noise',                color: '#3498db' },
  ].filter(t => isTrue(edesig[`${t.key}_code`])) : []

  const narrative = edesig ? buildNarrative(edesig, borough) : []
  const isActive = oer?.class?.includes('Active')
  const oerStatusColor = oer ? (isActive ? '#9b59b6' : '#16a085') : null
  const oerPrograms = oer?.oer_program?.split(',').map(p => p.trim()) || []

  async function exportPDF() {
    const doc = new jsPDF({ unit: 'pt', format: 'letter' })
    const L = 55, R = 557, W = R - L
    let y = 0

    // ── Fetch logo + map image in parallel ──────────────────────────
    const siteLat = edesig?.lat ?? oer?.lat
    const siteLng = edesig?.lng ?? oer?.lng
    const markerHex = edesig ? edesigColor(edesig) : (oer ? oerColor(oer) : '#888888')
    const [logoDataUrl, mapDataUrl] = await Promise.all([
      fetch('/logo.png').then(r => r.blob()).then(b => new Promise(res => {
        const rd = new FileReader(); rd.onload = e => res(e.target.result); rd.readAsDataURL(b)
      })).catch(() => null),
      (siteLat != null && siteLng != null)
        ? fetchMapTileImage(siteLat, siteLng, markerHex).catch(() => null)
        : Promise.resolve(null),
    ])

    // ── Layout helpers ───────────────────────────────────────────────
    function checkPage(needed = 24) {
      if (y + needed > 752) { doc.addPage(); y = 60 }
    }

    function sectionHeader(title, accentRgb = [26, 26, 46]) {
      checkPage(32)
      y += 8
      doc.setFillColor(...accentRgb)
      doc.rect(L, y, 3, 11, 'F')
      doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(...accentRgb)
      doc.text(title.toUpperCase(), L + 9, y + 9)
      y += 14
      doc.setDrawColor(225, 228, 235); doc.setLineWidth(0.4)
      doc.line(L, y, R, y)
      y += 10
    }

    function addPara(text, size = 9.5, color = [55, 65, 81], bold = false, indent = 0) {
      checkPage(20)
      doc.setFontSize(size)
      doc.setFont('helvetica', bold ? 'bold' : 'normal')
      doc.setTextColor(...color)
      const lines = doc.splitTextToSize(text, W - indent)
      doc.text(lines, L + indent, y)
      y += lines.length * (size * 1.42) + 5
    }

    function addRow(label, value, rowIdx) {
      if (!value || String(value).trim() === '' || value === '—' || value === 'N/A') return
      const valLines = doc.splitTextToSize(String(value), W - 152)
      const rh = Math.max(valLines.length * 13, 16)
      checkPage(rh + 2)
      if (rowIdx % 2 === 0) {
        doc.setFillColor(247, 249, 253)
        doc.rect(L - 2, y - 11, W + 4, rh, 'F')
      }
      doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(120, 128, 145)
      doc.text(label, L + 2, y)
      doc.setFont('helvetica', 'normal'); doc.setTextColor(28, 32, 42)
      doc.text(valLines, L + 150, y)
      y += rh
    }

    // ── HEADER ──────────────────────────────────────────────────────
    doc.setFillColor(26, 26, 46)
    doc.rect(0, 0, 612, 84, 'F')
    doc.setFillColor(52, 152, 219)
    doc.rect(0, 84, 612, 3, 'F')

    if (logoDataUrl) doc.addImage(logoDataUrl, 'PNG', L, 17, 48, 48)
    const titleX = logoDataUrl ? L + 58 : L

    doc.setFontSize(16); doc.setFont('helvetica', 'bold'); doc.setTextColor(255, 255, 255)
    doc.text(edesig ? 'E-Designation Site Report' : 'OER Cleanup Site Report', titleX, 34)

    doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(155, 168, 192)
    doc.text(edesig
      ? `${edesig.enumber}  ·  ${borough}  ·  BBL ${edesig.bbl}`
      : `${oer?.project_name ?? '—'}  ·  ${borough}`,
      titleX, 49)

    doc.setFontSize(7.5); doc.setTextColor(95, 108, 130)
    doc.text(`Impact Environmental  ·  impactenvironmental.com  ·  ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`, titleX, 63)

    // Designation pills — right-aligned
    let pillX = R
    const hPills = []
    if (oer) hPills.push({ label: isActive ? 'OER ACTIVE' : 'OER DONE', hex: isActive ? '#9b59b6' : '#16a085' })
    if (edesig) {
      if (isTrue(edesig.noise_code))  hPills.push({ label: 'NOISE',  hex: edesig.noise_date  ? '#27ae60' : '#3498db' })
      if (isTrue(edesig.air_code))    hPills.push({ label: 'AIR',    hex: edesig.air_date    ? '#27ae60' : '#e67e22' })
      if (isTrue(edesig.hazmat_code)) hPills.push({ label: 'HAZMAT', hex: edesig.hazmat_date ? '#27ae60' : '#e74c3c' })
    }
    hPills.forEach(({ label, hex }) => {
      doc.setFontSize(7); doc.setFont('helvetica', 'bold')
      const pw = doc.getTextWidth(label) + 12
      pillX -= (pw + 5)
      doc.setFillColor(...hexToRgb(hex))
      doc.roundedRect(pillX, 52, pw, 14, 3, 3, 'F')
      doc.setTextColor(255, 255, 255)
      doc.text(label, pillX + 6, 62)
    })

    y = 100

    // ── SITE LOCATION MAP ────────────────────────────────────────────
    if (mapDataUrl) {
      sectionHeader('Site Location')
      const mW = W, mH = 184
      checkPage(mH + 20)
      doc.setDrawColor(205, 212, 225); doc.setLineWidth(0.5)
      doc.rect(L - 1, y - 1, mW + 2, mH + 2)
      doc.addImage(mapDataUrl, 'JPEG', L, y, mW, mH)
      doc.setFontSize(6.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(160, 160, 160)
      doc.text('Map data © OpenStreetMap contributors', R - 2, y + mH - 5, { align: 'right' })
      y += mH + 18
    }

    // ── PROPERTY & REGULATORY INFORMATION ───────────────────────────
    sectionHeader('Property & Regulatory Information')
    const propRows = []
    if (edesig) {
      propRows.push(['E-Designation No.', edesig.enumber])
      propRows.push(['Borough', borough])
      propRows.push(['BBL', edesig.bbl])
      propRows.push(['Block / Lot', `${edesig.taxblock} / ${edesig.taxlot}`])
      propRows.push(['Effective Date', fmt(edesig.effective_date)])
      propRows.push(['CEQR Number', edesig.ceqr_num])
      propRows.push(['ULURP Number', edesig.ulurp_num])
      propRows.push(['Zoning Map', edesig.zoning_map])
    }
    if (oer) {
      propRows.push(['OER Project No.', oer.oer_project_numbers])
      propRows.push(['Project Name', oer.project_name])
      propRows.push(['Address', [oer.street_number, oer.street_name, oer.borough].filter(Boolean).join(' ')])
      propRows.push(['OER Program', oer.oer_program])
      propRows.push(['Status', oer.class])
      propRows.push(['Phase', oer.phase])
      propRows.push(['Neighborhood', oer.nta_name])
      propRows.push(['Zip Code', oer.zip_code])
      if (siteLat != null) propRows.push(['Coordinates', `${siteLat.toFixed(5)}, ${siteLng.toFixed(5)}`])
    }
    propRows.forEach(([label, value], i) => addRow(label, value, i))
    y += 8

    // ── ENVIRONMENTAL DESIGNATION STATUS ────────────────────────────
    if (edesig && eTypes.length > 0) {
      sectionHeader('Environmental Designation Status')
      const pdfTypes = [
        { key: 'hazmat', label: 'Hazardous Materials', rgb: [231, 76, 60] },
        { key: 'air',    label: 'Air Quality',         rgb: [230, 126, 34] },
        { key: 'noise',  label: 'Noise',               rgb: [52, 152, 219] },
      ].filter(t => isTrue(edesig[`${t.key}_code`]))
      pdfTypes.forEach(({ key, label, rgb }) => {
        const remDate = edesig[`${key}_date`]
        checkPage(26)
        const light = rgb.map(c => Math.round(c * 0.1 + 255 * 0.9))
        doc.setFillColor(...light); doc.rect(L, y - 11, W, 18, 'F')
        doc.setFillColor(...rgb);   doc.rect(L, y - 11, 4, 18, 'F')
        doc.setFontSize(9.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...rgb)
        doc.text(label, L + 10, y)
        const statusLabel = remDate ? `Remediated  ${fmt(remDate)}` : 'ACTIVE'
        const pillRgb = remDate ? [39, 174, 96] : rgb
        doc.setFontSize(7.5); doc.setFont('helvetica', 'bold')
        const pw = doc.getTextWidth(statusLabel) + 14
        doc.setFillColor(...pillRgb)
        doc.roundedRect(R - pw, y - 9, pw, 13, 2, 2, 'F')
        doc.setTextColor(255, 255, 255); doc.text(statusLabel, R - pw + 6, y)
        y += 20
      })
      y += 4
    }

    // ── ENVIRONMENTAL ASSESSMENT NARRATIVE ──────────────────────────
    if (narrative.length > 0) {
      sectionHeader('Environmental Assessment Narrative')
      narrative.forEach((p, i) => {
        if (i === 0) {
          doc.setFontSize(9.5); doc.setFont('helvetica', 'normal')
          const lines = doc.splitTextToSize(p, W - 16)
          const bh = lines.length * (9.5 * 1.42) + 16
          checkPage(bh + 8)
          doc.setFillColor(240, 245, 255); doc.rect(L, y - 10, W, bh, 'F')
          doc.setFillColor(52, 152, 219);  doc.rect(L, y - 10, 3, bh, 'F')
          doc.setTextColor(38, 50, 80)
          doc.text(lines, L + 9, y + 2)
          y += bh + 8
        } else {
          addPara(p); y += 3
        }
      })
    }

    // ── OER CLEANUP SITE CONTEXT ─────────────────────────────────────
    if (oer) {
      const oerRgb = isActive ? [155, 89, 182] : [22, 160, 133]
      sectionHeader('OER Cleanup Site Context', oerRgb)
      oerPrograms.forEach(prog => {
        const key = Object.keys(OER_PROGRAMS).find(k => prog.includes(k))
        if (!key) return
        addPara(`${OER_PROGRAMS[key].label}:`, 9.5, [50, 50, 70], true)
        y -= 4
        addPara(OER_PROGRAMS[key].desc, 9.5, [70, 80, 95], false, 8)
        y += 2
      })
      const phaseKey = Object.keys(OER_PHASES).find(k => oer.phase?.includes(k))
      if (phaseKey) {
        addPara(`Current Phase — ${phaseKey}:`, 9.5, [50, 50, 70], true)
        y -= 4
        addPara(OER_PHASES[phaseKey], 9.5, [70, 80, 95], false, 8)
      }
      addPara('For contaminants of concern and detailed remedial action documentation, refer to the OER EPIC project documents (link below).', 9, [130, 135, 150])
    }

    // ── DOCUMENT REFERENCES ──────────────────────────────────────────
    sectionHeader('Environmental Review Documents & References')
    const links = []
    if (edesig?.ceqr_num) links.push([`CEQR / FEIS Documents  (${edesig.ceqr_num})`, `https://a002-ceqhome.nyc.gov/search/search.aspx?ceqrnum=${encodeURIComponent(edesig.ceqr_num)}`])
    if (oer?.epicUrl)     links.push(['OER EPIC Project Documents  (Contaminants & Remedial Actions)', oer.epicUrl])
    if (edesig)           links.push(['NYC ZoLa — Zoning & Land Use Map', `https://zola.planning.nyc.gov/?bbl=${edesig.bbl}`])
    if (edesig)           links.push(['ACRIS Property Records', `https://a836-acris.nyc.gov/DS/DocumentSearch/BBLResult?hid_borough=${edesig.borocode}&hid_block=${edesig.taxblock}&hid_lot=${edesig.taxlot}&hid_SearchType=BBL`])
    links.push(['NYC OER E-Designation Program', 'https://www.nyc.gov/site/oer/remediation/e-designation.page'])
    links.forEach(([label, url]) => {
      checkPage(34)
      doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(28, 95, 155)
      doc.text(label, L + 4, y)
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(65, 120, 175)
      doc.textWithLink(url, L + 12, y + 12, { url })
      y += 28
    })

    // ── MARKETING BLOCK — anchored to bottom of last page ───────────
    const { headline, body, cta } = buildMarketingContent(edesig, oer)
    const mBodyLines = doc.splitTextToSize(body, W - 60)
    const mBlockH = Math.max(130, mBodyLines.length * (9 * 1.35) + 68)

    // If the block won't fit below current content, push to a new page
    if (y + mBlockH > 778) doc.addPage()
    // Always pin to the very bottom of whichever page it lands on
    y = 778 - mBlockH

    doc.setFillColor(26, 26, 46); doc.rect(0, y, 612, mBlockH, 'F')
    doc.setFillColor(52, 152, 219); doc.rect(0, y, 612, 2.5, 'F')
    const fy = y + 2
    if (logoDataUrl) doc.addImage(logoDataUrl, 'PNG', L, fy + 10, 44, 44)
    const mx = logoDataUrl ? L + 54 : L
    doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor(255, 255, 255)
    doc.text(headline, mx, fy + 24)
    doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(185, 195, 215)
    doc.text(mBodyLines, mx, fy + 38)
    doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(255, 255, 255)
    doc.text(cta, L, fy + mBlockH - 28)
    doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(105, 175, 255)
    doc.textWithLink('www.impactenvironmental.com', L, fy + mBlockH - 14, { url: 'https://impactenvironmental.com/' })

    // ── PAGE FOOTERS ─────────────────────────────────────────────────
    const total = doc.getNumberOfPages()
    for (let i = 1; i <= total; i++) {
      doc.setPage(i)
      doc.setFillColor(243, 244, 247); doc.rect(0, 778, 612, 14, 'F')
      doc.setFontSize(6.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(170, 175, 185)
      doc.text(`Impact Environmental  ·  NYC Environmental Site Report  ·  Page ${i} of ${total}`, L, 787)
      doc.text('Data: NYC Open Data (OER E-Designations, OER Cleanup Sites, MapPLUTO)  ·  For informational use only', R, 787, { align: 'right' })
    }

    doc.save(edesig ? `EDesig_${edesig.enumber}_BBL${edesig.bbl}.pdf` : `OER_${(oer.project_name || 'site').replace(/\s+/g, '_')}.pdf`)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>

      {/* Header */}
      <div style={{ background: '#1a1a2e', color: '#fff', padding: '18px 20px', flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {edesig && <>
              <div style={{ fontSize: 10, color: '#666', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 2 }}>E-Designation</div>
              <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.5 }}>{edesig.enumber}</div>
            </>}
            {oer && <div style={{ fontSize: 13, fontWeight: 600, color: edesig ? '#aaa' : '#fff', marginTop: edesig ? 4 : 0, lineHeight: 1.3 }}>{oer.project_name}</div>}
            <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
              {borough}{edesig ? ` · Block ${edesig.taxblock} · Lot ${edesig.taxlot}` : oer ? ` · ${oer.street_number} ${oer.street_name}` : ''}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid #333', color: '#aaa', width: 30, height: 30, borderRadius: 6, cursor: 'pointer', fontSize: 14, flexShrink: 0, marginLeft: 12 }}>✕</button>
        </div>

        {/* Status pills */}
        <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
          {eTypes.map(t => (
            <span key={t.key} style={{ fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 12, background: t.color, color: '#fff', letterSpacing: 0.3 }}>{t.label}</span>
          ))}
          {oer && (
            <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 12, background: oerStatusColor, color: '#fff', letterSpacing: 0.3 }}>
              OER · {isActive ? 'Active' : 'Completed'}
            </span>
          )}
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: '16px 20px', flex: 1 }}>

        {/* Export */}
        <button onClick={() => exportPDF()} style={{ width: '100%', padding: '10px', marginBottom: 20, background: '#1a1a2e', color: '#fff', border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: 13, fontWeight: 600, letterSpacing: 0.2 }}>
          ⬇ Export Site Report (PDF)
        </button>

        {/* E-designation narrative */}
        {narrative.length > 0 && <>
          <PanelSection title="Why This Site Was Flagged">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {narrative.map((p, i) => (
                <p key={i} style={{ fontSize: 12, color: '#444', lineHeight: 1.7, margin: 0, padding: '10px 12px', background: i === 0 ? '#f0f4ff' : 'transparent', borderRadius: 6, borderLeft: i === 0 ? '3px solid #3498db' : '3px solid #e8e8e8' }}>{p}</p>
              ))}
            </div>
          </PanelSection>
        </>}

        {/* OER Cleanup Status */}
        {oer && <PanelSection title="OER Cleanup Site">
          <div style={{ background: oerStatusColor + '12', border: `1px solid ${oerStatusColor}33`, borderRadius: 8, padding: '14px 16px', marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ fontWeight: 700, color: oerStatusColor, fontSize: 14 }}>{oer.project_name}</div>
              <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 10, background: oerStatusColor, color: '#fff' }}>
                {isActive ? 'ACTIVE' : 'COMPLETED'}
              </span>
            </div>
            <InfoTable rows={[
              ['Phase', oer.phase],
              ['Program', oer.oer_program],
              ['Project #', oer.oer_project_numbers],
              ['Neighborhood', oer.nta_name],
              ['Address', oer.street_number && `${oer.street_number} ${oer.street_name}`],
            ]} />

            {/* Phase description */}
            {oer.phase && OER_PHASES[Object.keys(OER_PHASES).find(k => oer.phase?.includes(k))] && (
              <div style={{ marginTop: 10, fontSize: 12, color: '#555', lineHeight: 1.6, padding: '8px 10px', background: 'rgba(255,255,255,0.6)', borderRadius: 5 }}>
                {OER_PHASES[Object.keys(OER_PHASES).find(k => oer.phase?.includes(k))]}
              </div>
            )}

            {/* Program descriptions */}
            {oerPrograms.map(prog => {
              const key = Object.keys(OER_PROGRAMS).find(k => prog.includes(k))
              if (!key) return null
              return (
                <div key={key} style={{ marginTop: 8, fontSize: 12, color: '#555', lineHeight: 1.6, padding: '8px 10px', background: 'rgba(255,255,255,0.6)', borderRadius: 5 }}>
                  <strong style={{ color: '#333' }}>{OER_PROGRAMS[key].label}:</strong> {OER_PROGRAMS[key].desc}
                </div>
              )
            })}
          </div>

          {/* EPIC link */}
          {oer.epicUrl && (
            <a href={oer.epicUrl} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', background: oerStatusColor, color: '#fff', borderRadius: 7, textDecoration: 'none', marginBottom: 8 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13 }}>View Contaminants & Remedial Actions</div>
                <div style={{ fontSize: 11, opacity: 0.8, marginTop: 2 }}>OER EPIC Project Document Repository →</div>
              </div>
              <span style={{ fontSize: 20 }}>📄</span>
            </a>
          )}
        </PanelSection>}

        {/* FEIS Documents */}
        {edesig?.ceqr_num && <PanelSection title="FEIS & Environmental Review Documents">
          <div style={{ background: '#f3eeff', border: '1px solid #dcc8f5', borderRadius: 7, padding: '12px 14px' }}>
            <div style={{ fontSize: 11, color: '#7d3c98', fontWeight: 700, marginBottom: 4 }}>CEQR Number: {edesig.ceqr_num}</div>
            <div style={{ fontSize: 12, color: '#555', lineHeight: 1.5, marginBottom: 10 }}>
              The Final Environmental Impact Statement (FEIS) and all associated CEQR review documents are accessible through the NYC CEQR document search portal.
            </div>
            <a href={`https://a002-ceqhome.nyc.gov/search/search.aspx?ceqrnum=${encodeURIComponent(edesig.ceqr_num)}`}
              target="_blank" rel="noreferrer"
              style={{ display: 'block', padding: '9px', background: '#7d3c98', color: '#fff', borderRadius: 5, fontSize: 12, fontWeight: 600, textDecoration: 'none', textAlign: 'center' }}>
              Search CEQR Documents for {edesig.ceqr_num} →
            </a>
          </div>
        </PanelSection>}

        {/* Designation status */}
        {eTypes.length > 0 && <PanelSection title="Designation Status">
          {[
            { key: 'hazmat', label: 'Hazardous Materials', color: '#e74c3c' },
            { key: 'air',    label: 'Air Quality',          color: '#e67e22' },
            { key: 'noise',  label: 'Noise',                color: '#3498db' },
          ].filter(t => edesig && isTrue(edesig[`${t.key}_code`])).map(t => {
            const remDate = edesig[`${t.key}_date`] ? fmt(edesig[`${t.key}_date`]) : null
            return (
              <div key={t.key} style={{ borderLeft: `4px solid ${t.color}`, background: t.color + '10', borderRadius: '0 6px 6px 0', padding: '9px 12px', marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 700, color: t.color, fontSize: 13 }}>{t.label}</span>
                <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 9px', borderRadius: 10, background: remDate ? '#27ae60' : t.color, color: '#fff' }}>
                  {remDate ? `Remediated ${remDate}` : 'ACTIVE'}
                </span>
              </div>
            )
          })}
        </PanelSection>}

        {/* Property details */}
        <PanelSection title="Property Details">
          <InfoTable rows={[
            ['Borough', borough],
            edesig && ['BBL', edesig.bbl],
            edesig && ['Tax Block', edesig.taxblock],
            edesig && ['Tax Lot', edesig.taxlot],
            edesig && ['Zoning Map', edesig.zoning_map],
            edesig && ['Effective Date', fmt(edesig.effective_date)],
            edesig && ['CEQR #', edesig.ceqr_num],
            edesig && ['ULURP #', edesig.ulurp_num],
            oer && ['OER Project #', oer.oer_project_numbers],
            oer && ['Zip Code', oer.zip_code],
            oer && ['Community Board', oer.community_district && `CB ${oer.community_district}`],
            (edesig?.lat || oer?.lat) && ['Coordinates', `${(edesig?.lat || oer?.lat).toFixed(5)}, ${(edesig?.lng || oer?.lng).toFixed(5)}`],
          ].filter(Boolean)} />
        </PanelSection>

        {/* External links */}
        <PanelSection title="External Resources">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {oer?.epicUrl && <ExtLink href={oer.epicUrl} color="#9b59b6">OER EPIC Documents →</ExtLink>}
            {edesig && <ExtLink href={`https://zola.planning.nyc.gov/?bbl=${edesig.bbl}`} color="#1a6ea8">NYC ZoLa Zoning Map →</ExtLink>}
            {edesig && <ExtLink href={`https://a836-acris.nyc.gov/DS/DocumentSearch/BBLResult?hid_borough=${edesig.borocode}&hid_block=${edesig.taxblock}&hid_lot=${edesig.taxlot}&hid_SearchType=BBL`} color="#555">ACRIS Property Records →</ExtLink>}
            <ExtLink href="https://www.nyc.gov/site/oer/remediation/e-designation.page" color="#16a085">NYC OER E-Designation Info →</ExtLink>
            <ExtLink href="https://www.nyc.gov/site/oer/remediation/cleanup-program.page" color="#16a085">NYC OER Cleanup Program →</ExtLink>
          </div>
        </PanelSection>
      </div>
    </div>
  )
}

function PanelSection({ title, children }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', color: '#bbb', marginBottom: 10, paddingBottom: 6, borderBottom: '1px solid #e8e8e8' }}>{title}</div>
      {children}
    </div>
  )
}

function InfoTable({ rows }) {
  return (
    <div>
      {rows.filter(r => r && r[1]).map(([label, value]) => (
        <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '6px 0', borderBottom: '1px solid #f0f0f0' }}>
          <span style={{ fontSize: 12, color: '#aaa', fontWeight: 600, flexShrink: 0, marginRight: 12 }}>{label}</span>
          <span style={{ fontSize: 12, color: '#333', textAlign: 'right', wordBreak: 'break-word', maxWidth: '65%' }}>{value}</span>
        </div>
      ))}
    </div>
  )
}

function ExtLink({ href, color, children }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" style={{ display: 'block', padding: '8px 12px', borderRadius: 6, border: `1px solid ${color}33`, background: `${color}0c`, color, fontSize: 12, fontWeight: 600, textDecoration: 'none' }}>
      {children}
    </a>
  )
}
