"""draw.io XML parser — extracts structured data from App Architecture and Tech Architecture diagrams.

Supports:
  - Compressed diagram content (base64 + zlib deflate + URL encoding)
  - Inline mxGraphModel content
  - Format A: C4 model (<object c4Name="..." ...>)
  - Format B: Plain mxCell with multiline value
  - Standard ID extraction (A\\d{5,6})
  - fillColor → application_status mapping
  - Interaction extraction from edges (label pattern, strokeColor)
  - Tech Architecture: datacenters, network zones, components, connections
"""

from __future__ import annotations

import base64
import re
import zlib
from typing import Optional
from urllib.parse import unquote
from xml.etree import ElementTree as ET


# ---------------------------------------------------------------------------
# Color → status mappings
# ---------------------------------------------------------------------------

FILL_COLOR_MAP: dict[str, str] = {
    "#dae8fc": "Keep",
    "#fff2cc": "Change",
    "#f8cecc": "New",
    "#f5f5f5": "3rd Party",
    "#1062b3": "3rd Party",
    "#1ba1e2": "3rd Party",
    "#757575": "Sunset",
    "#808080": "Sunset",
    "#9e9e9e": "Sunset",
}

STROKE_COLOR_MAP: dict[str, str] = {
    "#000000": "Keep",
    "": "Keep",
    "#d6b656": "Change",
    "#999900": "Change",
    "#cc0000": "New",
    "#b85450": "New",
    "#ff9999": "New",
    "#ff0000": "New",
    "#ff6666": "New",
    "#e6194b": "New",
}

# Legend items to skip (exact or substring match on lowercased value)
LEGEND_PATTERNS = [
    "system description and purpose",
    "application name",
    "application id",
    "legend",
    # Template example placeholders
    "exist system",
    "changed application or component",
    "new application or component",
    "sunset application or component",
    "company: legal",
    "company:legal",
    "3rd-parties app name",
    "3rd party app name",
    # Interaction type legend icons
    "command requestor",
    "command executor",
    "event producer",
    "event consumer",
    "service consumer",
    "service provider",
    "content producer",
    "content container",
    # Title text
    "title:",
    "title：",
    # User/role shapes (not applications)
    "roles or user",
    "role or user",
    "users",
    # Other template labels
    "illustrative",
    "exist interface",
    "changed interface",
    "new interface",
]

# Tech Arch Legend labels — use EXACT match (not substring) to avoid false positives
# These are the legend icon/label texts that should NOT be treated as tech components
TECH_LEGEND_EXACT_LABELS = frozenset({
    "web layer", "application backend layer", "application layer",
    "persistence layer", "integration layer", "data layer", "backend layer",
    "business application", "technical platform", "component",
    "tdp shared or generated service", "shared service",
    "vpn/mlps", "vpn/mpls", "vpc peering", "security group",
    "k8s pod", "k8s cluster", "k8s service", "k8 service", "k8 pod", "k8 cluster",
    "vm", "dataflow", "internet",
    "earth router",
})

# Fill colors that indicate legend/decoration items (not real applications)
LEGEND_FILL_COLORS = {"none", ""}

# Fill colors for user/role shapes (not applications)
ROLE_FILL_COLORS = {"#008a00"}

# Standard ID pattern: A followed by 5 or 6 digits
# Trailing \b removed — ID may be followed directly by app name (e.g. "A003530OVP")
STANDARD_ID_RE = re.compile(r"\bA\d{5,6}")

# Known compound protocols that should NOT be split on "/"
COMPOUND_PROTOCOLS = frozenset({"jdbc/ssl", "grpc/tls", "https/tls", "sftp/ssh"})

# Network protocol labels — these are annotations, not components.
# Cells whose cleaned name matches one of these (case-insensitive) are excluded
# from tech components and all_cell_names so edges to them are also filtered.
PROTOCOL_LABELS = frozenset({
    "mpls", "https", "http", "tcp", "udp", "tls", "ssl", "ssh", "sftp",
    "grpc", "jdbc", "rest", "soap", "amqp", "mqtt", "ftp", "ftps",
    "vpn", "ipsec", "saml", "oauth2", "ldap", "dns", "nfs", "smb",
})

# Interaction label patterns:
#   "BusinessObject [InteractionType]"  (type at end)
#   "[InteractionType] BusinessObject"  (type at start, from multi-label edges)
INTERACTION_LABEL_RE = re.compile(r"^(.+?)\s*\[(\w+)\]\s*$")
INTERACTION_LABEL_RE_PREFIX = re.compile(r"^\[(\w+)\]\s*(.+)$")


# ---------------------------------------------------------------------------
# Tech component classification keywords
# ---------------------------------------------------------------------------

_DEPLOY_MODE_KEYWORDS: dict[str, list[str]] = {
    "Docker": ["docker", "container", "containerized"],
    "Kubernetes": ["kubernetes", "k8s", "k8", "openshift", "eks", "aks", "gke", "rancher"],
    "VM": ["vm", "virtual machine", "vmware", "esxi", "hyperv", "hyper-v", "ec2", "compute engine"],
    "Physical": ["physical", "bare metal", "baremetal", "on-prem", "on-premise", "dedicated server"],
    "Serverless": ["lambda", "cloud function", "azure function", "serverless", "faas"],
    "PaaS": ["heroku", "app engine", "elastic beanstalk", "cloud run", "app service"],
}

_RUNTIME_KEYWORDS: dict[str, list[str]] = {
    "Java": ["java", "jvm", "spring", "spring boot", "springboot", "tomcat", "wildfly", "jboss", "quarkus"],
    ".NET": [".net", "dotnet", "c#", "asp.net", "aspnet", "blazor"],
    "Python": ["python", "django", "flask", "fastapi", "gunicorn", "uvicorn"],
    "Node.js": ["node", "nodejs", "node.js", "express", "nestjs", "next.js", "nextjs", "deno", "bun"],
    "Go": ["golang", " go ", " gin ", "fiber"],
    "Rust": ["rust", "actix", "axum"],
    "PHP": ["php", "laravel", "symfony", "wordpress"],
    "Ruby": ["ruby", "rails", "ruby on rails"],
}

_COMPONENT_TYPE_KEYWORDS: dict[str, list[str]] = {
    "Database": ["database", "db", "postgres", "postgresql", "mysql", "mariadb", "oracle", "mssql",
                 "sql server", "mongodb", "cassandra", "redis", "dynamodb", "cosmosdb",
                 "elasticsearch", "opensearch", "rds", "aurora"],
    "MessageQueue": ["kafka", "rabbitmq", "activemq", "sqs", "sns", "pubsub", "event hub",
                     "message queue", "mq", "nats", "pulsar", "kinesis", "celery"],
    "Cache": ["redis", "memcached", "varnish", "cdn", "cloudfront", "akamai", "cache"],
    "LoadBalancer": ["load balancer", "lb", "nginx", "haproxy", "alb", "nlb", "elb",
                     "f5", "traefik", "envoy", "istio"],
    "Gateway": ["api gateway", "gateway", "kong", "apigee", "zuul", "apisix"],
    "Storage": ["s3", "blob storage", "gcs", "minio", "nfs", "efs", "object storage",
                "file storage", "nas", "san"],
    "Monitoring": ["prometheus", "grafana", "datadog", "splunk", "elk", "kibana",
                   "new relic", "dynatrace", "cloudwatch", "monitor"],
    "CICD": ["jenkins", "gitlab", "github actions", "argocd", "flux", "tekton",
             "ci/cd", "cicd", "pipeline"],
    "Identity": ["keycloak", "okta", "auth0", "ldap", "active directory", "ad",
                 "iam", "sso", "identity"],
}


def _classify_component(
    name: str,
    style: str,
    entity_type_map: dict[str, str] | None = None,
    icon_deploy_mode: str = "",
) -> dict[str, str]:
    """Infer component_type, deploy_mode, runtime, and entity_type from name, style, and Legend.

    Args:
        name: Component display name.
        style: draw.io style string.
        entity_type_map: fillColor → entity_type from Tech Legend (e.g. {"#d5e8d4": "Business Application"}).
        icon_deploy_mode: Deploy mode inferred from nearby runtime icon (e.g. "Kubernetes", "VM").

    Returns dict with keys: component_type, deploy_mode, runtime, entity_type.
    Values default to empty string when not determinable.
    """
    lower_name = f" {name.lower()} "  # pad with spaces for word-boundary matching
    lower_style = style.lower()

    # Deploy mode: icon-based first (most accurate), then keyword
    deploy_mode = icon_deploy_mode
    if not deploy_mode:
        for mode, keywords in _DEPLOY_MODE_KEYWORDS.items():
            if any(kw in lower_name or kw in lower_style for kw in keywords):
                deploy_mode = mode
                break

    # Runtime / tech stack
    runtime = ""
    for rt, keywords in _RUNTIME_KEYWORDS.items():
        if any(kw in lower_name for kw in keywords):
            runtime = rt
            break

    # Component type from keyword analysis
    component_type = ""
    for ct, keywords in _COMPONENT_TYPE_KEYWORDS.items():
        if any(kw in lower_name for kw in keywords):
            component_type = ct
            break
    # Default to "Application" if no specific type detected
    if not component_type:
        component_type = "Application"

    # Entity type from Legend fillColor (Business Application vs Technical Platform)
    entity_type = ""
    if entity_type_map:
        fill = _get_fill_color(style)
        if fill:
            entity_type = entity_type_map.get(fill.lower(), "")

    return {
        "component_type": component_type,
        "deploy_mode": deploy_mode,
        "runtime": runtime,
        "entity_type": entity_type,
    }


# ---------------------------------------------------------------------------
# Compression helpers
# ---------------------------------------------------------------------------

def decompress_drawio_content(xml_content: str) -> str:
    """Detect and decompress draw.io diagram content if compressed.

    draw.io stores compressed diagrams as:
      base64(deflate(url_encode(mxGraphModel_xml)))

    Returns the full XML (with mxGraphModel accessible).
    """
    try:
        root = ET.fromstring(xml_content)
    except ET.ParseError:
        return xml_content

    # Find all <diagram> elements
    diagrams = root.findall(".//diagram") if root.tag != "diagram" else [root]
    if not diagrams:
        return xml_content

    diagram = diagrams[0]

    # Check if it already has inline XML children
    if len(diagram) > 0:
        # Inline content — return as-is
        return xml_content

    # Text content might be compressed
    text = (diagram.text or "").strip()
    if not text:
        return xml_content

    # Try to decompress: base64 decode → zlib raw inflate → url decode
    try:
        decoded = base64.b64decode(text)
        # Raw deflate: wbits=-15 skips the zlib header
        inflated = zlib.decompress(decoded, -15)
        url_decoded = unquote(inflated.decode("utf-8"))
        return url_decoded
    except Exception:
        # Not compressed — treat as plain text XML
        return text


# ---------------------------------------------------------------------------
# Style parsing helpers
# ---------------------------------------------------------------------------

def _parse_style(style: str) -> dict[str, str]:
    """Parse draw.io style string into a key-value dict."""
    result: dict[str, str] = {}
    for part in style.split(";"):
        part = part.strip()
        if "=" in part:
            k, _, v = part.partition("=")
            result[k.strip()] = v.strip()
        elif part:
            result[part] = "1"
    return result


def _get_fill_color(style: str) -> Optional[str]:
    """Extract the fillColor value from a draw.io style string."""
    parsed = _parse_style(style)
    return parsed.get("fillColor")


def _get_stroke_color(style: str) -> Optional[str]:
    """Extract the strokeColor value from a draw.io style string."""
    parsed = _parse_style(style)
    return parsed.get("strokeColor")


# Legend label → status mapping (used to extract dynamic color map from diagram)
_LEGEND_STATUS_KEYWORDS: dict[str, str] = {
    "exist": "Keep",
    "keep": "Keep",
    "no change": "Keep",
    "unchanged": "Keep",
    "new": "New",
    "new build": "New",
    "change": "Change",
    "changed": "Change",
    "modify": "Change",
    "modified": "Change",
    "sunset": "Sunset",
    "retire": "Sunset",
    "decommission": "Sunset",
    "3rd party": "3rd Party",
    "3rd-party": "3rd Party",
    "third party": "3rd Party",
    "external": "3rd Party",
}


def _extract_legend_colors(root: ET.Element) -> dict[str, str]:
    """Scan the diagram for Legend items and build a dynamic fillColor → status map.

    Legend items are shapes with text matching LEGEND_PATTERNS keywords like
    "New Application or Component", "Exist System", "Sunset Application", etc.
    We extract their fillColor and map it to the corresponding status.

    Returns a dict like {"#f8cecc": "New", "#dae8fc": "Keep", "#757575": "Sunset"}.
    """
    dynamic_map: dict[str, str] = {}

    def _try_extract(text: str, fill_color: str | None) -> None:
        if not fill_color or fill_color.lower() in LEGEND_FILL_COLORS:
            return
        lower_text = text.lower().strip()
        # Match against known status keywords
        for keyword, status in _LEGEND_STATUS_KEYWORDS.items():
            if keyword in lower_text:
                color_key = fill_color.lower()
                if color_key not in dynamic_map:
                    dynamic_map[color_key] = status
                return

    # Scan <object> elements (C4 format legend items)
    for obj in root.iter("object"):
        c4_name = obj.get("c4Name") or obj.get("c4name") or ""
        label = _clean_html(obj.get("label", "")).strip() if obj.get("label") else ""
        text = c4_name or label
        if not text:
            continue
        child = obj.find("mxCell")
        if child is not None:
            style = child.get("style", "")
            fill = _get_fill_color(style)
            _try_extract(text, fill)

    # Scan plain <mxCell> elements
    for cell in root.iter("mxCell"):
        value = cell.get("value", "")
        if not value:
            continue
        clean = _clean_html(value).strip()
        if not clean:
            continue
        style = cell.get("style", "")
        fill = _get_fill_color(style)
        _try_extract(clean, fill)

    return dynamic_map


# ---------------------------------------------------------------------------
# Tech Architecture Legend extraction (3D info)
# ---------------------------------------------------------------------------

# Keywords for entity type legend items
_ENTITY_TYPE_KEYWORDS: dict[str, str] = {
    "business application": "Business Application",
    "business app": "Business Application",
    "technical platform": "Technical Platform",
    "tech platform": "Technical Platform",
    "infrastructure": "Technical Platform",
    "middleware": "Technical Platform",
    "tdp shared or generated service": "TDP Service",
    "tdp shared": "TDP Service",
    "shared or generated service": "TDP Service",
    "shared service": "TDP Service",
    "generated service": "TDP Service",
    "component": "Component",
    # "application" last — most generic, only match if nothing else did
    "application": "Business Application",
    "platform": "Technical Platform",
}

# Keywords for zone layer legend items
_ZONE_LAYER_KEYWORDS: dict[str, str] = {
    "web layer": "Web Layer",
    "web zone": "Web Layer",
    "presentation layer": "Web Layer",
    "frontend layer": "Web Layer",
    "dmz": "Web Layer",
    "backend layer": "Application Layer",
    "application backend layer": "Application Layer",
    "application backend": "Application Layer",
    "app backend layer": "Application Layer",
    "app backend": "Application Layer",
    "application layer": "Application Layer",
    "app layer": "Application Layer",
    "logic layer": "Application Layer",
    "service layer": "Application Layer",
    "persistence layer": "Persistence Layer",
    "data layer": "Persistence Layer",
    "database layer": "Persistence Layer",
    "storage layer": "Persistence Layer",
    "integration layer": "Integration Layer",
    "middleware layer": "Integration Layer",
}

# Keywords for runtime/deploy icon legend items
_RUNTIME_ICON_KEYWORDS: dict[str, str] = {
    "k8s pod": "Kubernetes",
    "kubernetes pod": "Kubernetes",
    "pod": "Kubernetes",
    "k8s cluster": "Kubernetes",
    "kubernetes cluster": "Kubernetes",
    "kubernetes": "Kubernetes",
    "k8s": "Kubernetes",
    "docker": "Docker",
    "container": "Docker",
    "vm": "VM",
    "virtual machine": "VM",
    "physical": "Physical",
    "bare metal": "Physical",
    "serverless": "Serverless",
    "lambda": "Serverless",
    "dataflow": "Dataflow",
    "k8s service": "Kubernetes",
}


def _extract_tech_legend(root: ET.Element) -> dict:
    """Extract 3-dimensional Legend info from a Tech Architecture diagram.

    Scans Legend items for:
    1. Entity type colors: fillColor → entity_type (Business Application / Technical Platform)
    2. Zone layer colors: fillColor → layer_type (Web Layer / Backend Layer / Persistence Layer)
    3. Runtime/deploy icons: shape style → deploy_mode (Kubernetes / VM / Docker)

    Returns dict with:
        entity_type_map: {fillColor: entity_type}
        zone_layer_map: {fillColor: layer_type}
        icon_deploy_map: {shape_style_key: deploy_mode}
        icon_shapes: list of {id, style, deploy_mode, geom} for proximity matching
    """
    entity_type_map: dict[str, str] = {}
    zone_layer_map: dict[str, str] = {}
    icon_deploy_map: dict[str, str] = {}

    def _check_entity_type(text: str, fill_color: str | None) -> None:
        if not fill_color or fill_color.lower() in LEGEND_FILL_COLORS:
            return
        lower_text = text.lower().strip()
        for keyword, entity_type in _ENTITY_TYPE_KEYWORDS.items():
            if keyword in lower_text:
                color_key = fill_color.lower()
                if color_key not in entity_type_map:
                    entity_type_map[color_key] = entity_type
                return

    def _check_zone_layer(text: str, fill_color: str | None) -> None:
        if not fill_color or fill_color.lower() in LEGEND_FILL_COLORS:
            return
        lower_text = text.lower().strip()
        for keyword, layer_type in _ZONE_LAYER_KEYWORDS.items():
            if keyword in lower_text:
                color_key = fill_color.lower()
                if color_key not in zone_layer_map:
                    zone_layer_map[color_key] = layer_type
                return

    def _check_runtime_icon(text: str, style: str) -> None:
        lower_text = text.lower().strip()
        for keyword, deploy_mode in _RUNTIME_ICON_KEYWORDS.items():
            if keyword in lower_text:
                # Extract the shape identifier from style to match against actual components
                parsed = _parse_style(style)
                shape = parsed.get("shape", "")
                if shape and shape not in icon_deploy_map:
                    icon_deploy_map[shape] = deploy_mode
                # Also check for stencil-based shapes (e.g. mxgraph.kubernetes.*)
                for part in style.split(";"):
                    if "stencil" in part.lower() or "image=" in part.lower():
                        key = part.strip()
                        if key and key not in icon_deploy_map:
                            icon_deploy_map[key] = deploy_mode
                return

    # Scan all cells for Legend items
    for cell in root.iter("mxCell"):
        value = cell.get("value", "")
        if not value:
            continue
        clean = _clean_html(value).strip()
        if not clean:
            continue
        style = cell.get("style", "")
        fill = _get_fill_color(style)

        _check_entity_type(clean, fill)
        _check_zone_layer(clean, fill)
        _check_runtime_icon(clean, style)

    # Scan <object> elements (C4 format)
    for obj in root.iter("object"):
        c4_name = obj.get("c4Name") or obj.get("c4name") or ""
        label = _clean_html(obj.get("label", "")).strip() if obj.get("label") else ""
        text = c4_name or label
        if not text:
            continue
        child = obj.find("mxCell")
        if child is not None:
            style = child.get("style", "")
            fill = _get_fill_color(style)
            _check_entity_type(text, fill)
            _check_zone_layer(text, fill)
            _check_runtime_icon(text, style)

    return {
        "entity_type_map": entity_type_map,
        "zone_layer_map": zone_layer_map,
        "icon_deploy_map": icon_deploy_map,
    }


def _find_nearby_icon_deploy_mode(
    comp_geom: tuple[float, float, float, float],
    icon_cells: list[dict],
    max_distance: float = 150.0,
) -> str:
    """Find the deploy mode of the nearest runtime icon associated with a component.

    Association strategies (priority order):
    1. **Containment**: Icon center is inside the component rectangle (or vice versa)
    2. **Proximity**: Icon center-to-component-center distance within max_distance

    Args:
        comp_geom: (x, y, w, h) of the component.
        icon_cells: list of {geom: (x,y,w,h), deploy_mode: str}.
        max_distance: Maximum distance in pixels for proximity association.

    Returns deploy_mode string or empty string if no icon is associated.
    """
    cx, cy, cw, ch = comp_geom

    # Strategy 1: containment — icon center inside component rect (or vice versa)
    for icon in icon_cells:
        ix, iy, iw, ih = icon["geom"]
        icon_cx, icon_cy = ix + iw / 2, iy + ih / 2
        # Icon center inside component rectangle
        if cx <= icon_cx <= cx + cw and cy <= icon_cy <= cy + ch:
            return icon["deploy_mode"]
        # Component center inside icon rectangle (icon is larger container)
        comp_cx, comp_cy = cx + cw / 2, cy + ch / 2
        if ix <= comp_cx <= ix + iw and iy <= comp_cy <= iy + ih:
            return icon["deploy_mode"]

    # Strategy 2: proximity — nearest icon within max_distance
    comp_center_x = cx + cw / 2
    comp_center_y = cy + ch / 2
    best_mode = ""
    best_dist = max_distance

    for icon in icon_cells:
        ix, iy, iw, ih = icon["geom"]
        icon_center_x = ix + iw / 2
        icon_center_y = iy + ih / 2
        dist = ((comp_center_x - icon_center_x) ** 2 + (comp_center_y - icon_center_y) ** 2) ** 0.5
        if dist < best_dist:
            best_dist = dist
            best_mode = icon["deploy_mode"]

    return best_mode


def _fill_to_status(fill_color: Optional[str], dynamic_map: dict[str, str] | None = None) -> str:
    """Map a fillColor hex string to an application status label.

    Uses dynamic_map (from Legend extraction) first, then falls back to FILL_COLOR_MAP.
    Returns 'Unknown' if the color is absent or not in either map.
    """
    if not fill_color:
        return "Unknown"
    lower = fill_color.lower()
    if dynamic_map:
        status = dynamic_map.get(lower)
        if status:
            return status
    return FILL_COLOR_MAP.get(lower, "Unknown")


def _stroke_to_status(stroke_color: Optional[str]) -> str:
    """Map a strokeColor hex string to an interaction status label.

    Returns 'Keep' if the color is absent or not in STROKE_COLOR_MAP.
    """
    if stroke_color is None:
        return "Keep"
    return STROKE_COLOR_MAP.get(stroke_color.lower(), "Keep")


def _is_legend(value: str, fill_color: str | None = None) -> bool:
    """Return True if the cell value or fill color indicates a legend/template item."""
    lower = value.lower().strip()
    # Substring match for App Arch legend patterns
    for pattern in LEGEND_PATTERNS:
        if pattern in lower:
            return True
    # Exact match for Tech Arch legend labels (avoid false positives like "vm" in "JVM")
    if lower in TECH_LEGEND_EXACT_LABELS:
        return True
    # Filter items with legend fill colors (fill:none = decoration shapes)
    if fill_color is not None and fill_color.lower().strip() in LEGEND_FILL_COLORS:
        return True
    # Filter role/user shapes by color
    if fill_color is not None and fill_color.lower().strip() in ROLE_FILL_COLORS:
        return True
    return False


# ---------------------------------------------------------------------------
# HTML / draw.io value cleaning
# ---------------------------------------------------------------------------

def _clean_html(text: str) -> str:
    """Strip simple HTML tags and decode common HTML entities from draw.io cell values."""
    # Skip URL-encoded XML content (e.g. %3CmxGraphModel%3E...)
    if "%3C" in text and "%3E" in text:
        return ""
    # Replace tags with spaces (so </div><div> doesn't merge words)
    cleaned = re.sub(r"<[^>]+>", " ", text)
    cleaned = cleaned.replace("&nbsp;", " ").replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
    # Collapse multiple spaces
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned.strip()


def _split_multiline(value: str) -> list[str]:
    """Split a draw.io multiline value on <br> tags."""
    parts = re.split(r"<br\s*/?>", value, flags=re.IGNORECASE)
    return [_clean_html(p).strip() for p in parts if _clean_html(p).strip()]


# ---------------------------------------------------------------------------
# Standard ID extraction
# ---------------------------------------------------------------------------

def _extract_standard_id(text: str) -> Optional[str]:
    """Return the first standard application ID (A##### or A######) found in text, or None."""
    match = STANDARD_ID_RE.search(text)
    return match.group(0) if match else None


def _extract_app_name(raw_name: str, std_id: Optional[str], functions: str = "") -> str:
    """Extract a clean application name by removing the standard ID prefix/suffix.

    Handles patterns like:
      "A003559EAM"          → "EAM"
      "ID: A001632"         → uses first function (e.g. "CMDB")
      "ID:A003749 KM Verse" → "KM Verse"
      "EAM"                 → "EAM" (no ID to strip)
    """
    if not std_id:
        return raw_name

    # Strip "ID:" prefix and the A###### pattern
    clean = re.sub(r"(?:ID:\s*)?A\d{5,6}\s*", "", raw_name, flags=re.IGNORECASE).strip()
    # Also strip common HTML entities
    clean = clean.replace("&nbsp;", " ").strip()

    if not clean and functions:
        # Name was just the ID — use first function as name
        clean = functions.split(",")[0].strip()

    return clean or raw_name


# ---------------------------------------------------------------------------
# App Architecture parsing
# ---------------------------------------------------------------------------

def _parse_app_arch(root: ET.Element) -> dict:
    """Parse App Architecture diagram, returning applications and interactions."""
    applications: list[dict] = []
    interactions: list[dict] = []

    # Extract dynamic color→status map from Legend area (Plan C: Legend first, fallback to hardcoded)
    legend_colors = _extract_legend_colors(root)

    # Build a map of cell id → cell element for edge label lookup
    all_cells: dict[str, ET.Element] = {}
    for cell in root.iter("mxCell"):
        cell_id = cell.get("id", "")
        if cell_id:
            all_cells[cell_id] = cell
    for obj in root.iter("object"):
        obj_id = obj.get("id", "")
        if obj_id:
            all_cells[obj_id] = obj

    # Build edge-label mapping: parent_edge_id → label text
    edge_labels: dict[str, str] = {}
    for cell in root.iter("mxCell"):
        style = cell.get("style", "")
        parent = cell.get("parent", "")
        value = cell.get("value", "")
        # edgeLabel cells have style containing "edgeLabel" and are children of edges
        if "edgeLabel" in style and parent and value:
            # Concatenate multiple labels on the same edge (e.g. "LLM Review" + "[Query]")
            if parent in edge_labels:
                edge_labels[parent] = edge_labels[parent] + " " + value
            else:
                edge_labels[parent] = value

    # --- Format A: C4 model --- <object c4Name="..." ...>
    for obj in root.iter("object"):
        c4_name = obj.get("c4Name") or obj.get("c4name")
        if not c4_name:
            continue

        c4_desc = obj.get("c4Description") or obj.get("c4description") or ""
        # Check label for richer info (may contain ID + real name)
        label_raw = obj.get("label", "")
        label_clean = _clean_html(label_raw).strip() if label_raw else ""
        label_std_id = _extract_standard_id(label_clean) if label_clean else None

        # If c4Name is generic (e.g. "Application") but label has a standard ID, use label
        if label_std_id and not _extract_standard_id(c4_name):
            # Label has the real app info — use it instead of generic c4Name
            lines = [l.strip() for l in label_clean.replace("\n", " ").split("  ") if l.strip()]
            c4_name = label_clean
            if not c4_desc and len(lines) > 1:
                c4_desc = " ".join(lines[1:])

        # Get style from child mxCell
        child_cell = obj.find("mxCell")
        style = child_cell.get("style", "") if child_cell is not None else ""
        fill_color = _get_fill_color(style)

        if _is_legend(c4_name, fill_color):
            continue
        status = _fill_to_status(fill_color, legend_colors)
        std_id = _extract_standard_id(c4_name) or _extract_standard_id(c4_desc) or label_std_id

        clean_c4_name = _extract_app_name(c4_name, std_id, c4_desc)
        # Get geometry from child mxCell for container merge
        c4_geom = child_cell.find("mxGeometry") if child_cell is not None else None
        c4_gx = float(c4_geom.get("x", 0) or 0) if c4_geom is not None else 0
        c4_gy = float(c4_geom.get("y", 0) or 0) if c4_geom is not None else 0
        c4_gw = float(c4_geom.get("width", 0) or 0) if c4_geom is not None else 0
        c4_gh = float(c4_geom.get("height", 0) or 0) if c4_geom is not None else 0
        applications.append({
            "cell_id": obj.get("id", ""),
            "app_name": clean_c4_name,
            "functions": c4_desc,
            "application_status": status,
            "fill_color": fill_color,
            "id_is_standard": std_id is not None,
            "standard_id": std_id,
            "_geom": (c4_gx, c4_gy, c4_gw, c4_gh),
        })

    # --- Format B: Plain mxCell with value ---
    skipped_cell_ids: set[str] = set()  # Track legend/role cells to filter their edges too
    # Pre-compute C4 names to skip already-parsed objects (built once, not per iteration)
    c4_names = {a["app_name"] for a in applications}
    for cell in root.iter("mxCell"):
        value = cell.get("value", "")
        style = cell.get("style", "")
        vertex = cell.get("vertex", "0")
        edge = cell.get("edge", "0")

        if edge == "1" or vertex != "1":
            continue
        if not value:
            continue
        if "edgeLabel" in style:
            continue
        # Skip if value matches a C4 name already parsed above
        if value in c4_names:
            continue

        lines = _split_multiline(value)
        if not lines:
            continue

        # Skip infrastructure cells (very small or no geometry)
        geom = cell.find("mxGeometry")
        if geom is not None:
            w = float(geom.get("width", 0) or 0)
            h = float(geom.get("height", 0) or 0)
            # Skip tiny cells (likely connectors or labels, not apps)
            if w < 40 or h < 20:
                continue

        name = lines[0]
        functions = ", ".join(lines[1:]) if len(lines) > 1 else ""
        fill_color = _get_fill_color(style)

        # Check all lines for legend patterns (template examples have keywords in 2nd/3rd line)
        full_text = " ".join(lines)
        if _is_legend(full_text, fill_color):
            skipped_cell_ids.add(cell.get("id", ""))
            continue
        status = _fill_to_status(fill_color, legend_colors)
        std_id = _extract_standard_id(value)

        # Store geometry for containment check
        geom = cell.find("mxGeometry")
        gx = float(geom.get("x", 0) or 0) if geom is not None else 0
        gy = float(geom.get("y", 0) or 0) if geom is not None else 0
        gw = float(geom.get("width", 0) or 0) if geom is not None else 0
        gh = float(geom.get("height", 0) or 0) if geom is not None else 0

        clean_name = _extract_app_name(name, std_id, functions)
        # Remove app name from functions to avoid duplication
        clean_funcs = functions
        if clean_name and clean_funcs:
            parts = [p.strip() for p in clean_funcs.split(",")]
            parts = [p for p in parts if p and p != clean_name]
            clean_funcs = ", ".join(parts)
        applications.append({
            "cell_id": cell.get("id", ""),
            "app_name": clean_name,
            "functions": clean_funcs,
            "application_status": status,
            "fill_color": fill_color,
            "id_is_standard": std_id is not None,
            "standard_id": std_id,
            "_geom": (gx, gy, gw, gh),
        })

    # --- Merge child apps into parent containers ---
    # If app A's geometry fully contains app B, B is a sub-component of A
    merged_ids: set[str] = set()
    for parent_app in applications:
        px, py, pw, ph = parent_app.get("_geom", (0, 0, 0, 0))
        if pw < 150 or ph < 100:  # too small to be a container
            continue
        children_names: list[str] = []
        children_statuses: set[str] = set()
        for child_app in applications:
            if child_app is parent_app:
                continue
            cx, cy, cw, ch = child_app.get("_geom", (0, 0, 0, 0))
            # Check if child is fully inside parent
            if (cx >= px and cy >= py and cx + cw <= px + pw and cy + ch <= py + ph):
                children_names.append(child_app["app_name"])
                children_statuses.add(child_app.get("application_status", ""))
                merged_ids.add(child_app["cell_id"])
        if children_names:
            existing_funcs = parent_app.get("functions", "")
            merged_funcs = ", ".join(children_names)
            parent_app["functions"] = f"{existing_funcs}, {merged_funcs}".strip(", ") if existing_funcs else merged_funcs
            parent_app["is_container"] = True
            parent_app["has_changed_children"] = bool(
                children_statuses & {"New", "Change", "Sunset"}
            )

    # Remove merged children from applications list
    if merged_ids:
        skipped_cell_ids.update(merged_ids)
        applications = [a for a in applications if a["cell_id"] not in merged_ids]

    # Build set of valid app cell IDs for interaction filtering
    valid_app_ids = {a["cell_id"] for a in applications if a.get("cell_id")}

    # Clean up internal _geom field
    for app in applications:
        app.pop("_geom", None)

    # --- Build cell_id → app lookup for resolving edge endpoints ---
    # Edges may reference a child <mxCell> id instead of the <object> id,
    # so build a mapping: any_cell_id → app_cell_id (the canonical id used in applications[])
    child_to_app: dict[str, str] = {}
    app_id_to_name: dict[str, str] = {}
    for app in applications:
        aid = app.get("cell_id", "")
        if aid:
            child_to_app[aid] = aid
            app_id_to_name[aid] = app.get("app_name", "")

    # For C4 <object> elements, the child <mxCell> id differs from the <object> id
    for obj in root.iter("object"):
        obj_id = obj.get("id", "")
        child_cell = obj.find("mxCell")
        if child_cell is not None:
            child_id = child_cell.get("id", "")
            if child_id:
                # Case A: object is the app (C4 format) → map child mxCell to app
                if obj_id in child_to_app:
                    child_to_app[child_id] = obj_id
                # Case B: child mxCell is the app (Format B inside <object>) → map object to app
                elif child_id in child_to_app:
                    child_to_app[obj_id] = child_id
                    app_id_to_name[obj_id] = app_id_to_name.get(child_id, "")

    # Also map any mxCell whose parent is a known app
    for cell in root.iter("mxCell"):
        cid = cell.get("id", "")
        parent_id = cell.get("parent", "")
        if cid and parent_id and cid not in child_to_app:
            if parent_id in child_to_app:
                child_to_app[cid] = child_to_app[parent_id]
            # Also check: if this cell IS an app but its parent is an <object>,
            # the edge might connect to the parent object id
            elif cid in child_to_app and parent_id:
                child_to_app[parent_id] = cid
                app_id_to_name[parent_id] = app_id_to_name.get(cid, "")

    def _resolve_app(raw_id: str | None) -> tuple[str | None, str | None]:
        """Resolve a raw mxCell id to (app_cell_id, app_name)."""
        if not raw_id:
            return None, None
        resolved = child_to_app.get(raw_id, raw_id)
        return resolved, app_id_to_name.get(resolved)

    # --- Edges / Interactions ---
    for cell in root.iter("mxCell"):
        edge = cell.get("edge", "0")
        if edge != "1":
            continue
        style = cell.get("style", "")
        if "edgeLabel" in style:
            continue

        cell_id = cell.get("id", "")
        raw_label = cell.get("value", "") or edge_labels.get(cell_id, "")

        stroke_color = _get_stroke_color(style)
        interaction_status = _stroke_to_status(stroke_color)

        # Parse label "BusinessObject [InteractionType]"
        biz_obj = None
        interaction_type = None
        clean_label = _clean_html(raw_label).strip()
        if clean_label:
            match = INTERACTION_LABEL_RE.match(clean_label)
            if match:
                biz_obj = match.group(1).strip()
                interaction_type = match.group(2).strip().lower()
            else:
                # Try prefix pattern: "[Type] BusinessObject" (from multi-label edges)
                match2 = INTERACTION_LABEL_RE_PREFIX.match(clean_label)
                if match2:
                    interaction_type = match2.group(1).strip().lower()
                    biz_obj = match2.group(2).strip()
                else:
                    biz_obj = clean_label

        # Direction: source → target is always outbound (draw.io convention)
        # Bidirectional only if both startArrow and endArrow are explicitly set
        parsed_style = _parse_style(style)
        end_arrow = parsed_style.get("endArrow", "")
        start_arrow = parsed_style.get("startArrow", "")
        if start_arrow and end_arrow:
            direction = "bidirectional"
        else:
            # Default: source → target = outbound (draw.io always has an arrow from source to target)
            direction = "outbound"

        raw_source = cell.get("source")
        raw_target = cell.get("target")

        # Skip legend interaction arrows (no real source/target, or label is a legend term)
        if not raw_source and not raw_target:
            continue
        if clean_label and _is_legend(clean_label):
            continue
        # Skip interactions connecting to filtered cells (legend/role items)
        if raw_source in skipped_cell_ids or raw_target in skipped_cell_ids:
            continue

        # Resolve edge endpoints to application cell_ids and names
        source_id, source_app = _resolve_app(raw_source)
        target_id, target_app = _resolve_app(raw_target)

        interactions.append({
            "edge_cell_id": cell_id,
            "business_object": biz_obj,
            "interaction_type": interaction_type,
            "interaction_status": interaction_status,
            "stroke_color": stroke_color,
            "direction": direction,
            "source_id": source_id,
            "target_id": target_id,
            "source_app": source_app,
            "target_app": target_app,
            "label": clean_label,
        })

    # Build cell_names map for rule engine (covers all cell id variants)
    all_cell_names: dict[str, str] = {}
    for cell in root.iter("mxCell"):
        cid = cell.get("id", "")
        val = cell.get("value", "")
        if cid and val:
            clean = _clean_html(val).strip()
            if clean and len(clean) > 1:
                all_cell_names[cid] = clean
    for obj in root.iter("object"):
        oid = obj.get("id", "")
        # Use c4Name, label, or c4Description as the name
        name = obj.get("c4Name") or obj.get("c4name") or ""
        if not name:
            name = _clean_html(obj.get("label", "")).strip()
        if oid and name and len(name) > 1:
            all_cell_names[oid] = name
        # Also map the child mxCell
        child = obj.find("mxCell")
        if child is not None:
            child_id = child.get("id", "")
            if child_id and name:
                all_cell_names[child_id] = name

    return {
        "applications": applications,
        "interactions": interactions,
        "cell_names": all_cell_names,
        "legend_colors": legend_colors,
    }


# ---------------------------------------------------------------------------
# Tech Architecture parsing
# ---------------------------------------------------------------------------

# Keywords that identify datacenters (case-insensitive)
DC_KEYWORDS = ["data center", "datacenter", "data centre", "datacentre", "dc"]

# Keywords that identify network zones (case-insensitive)
ZONE_KEYWORDS = ["dmz", "app zone", "db zone", "database zone", "vpc", "subnet",
                 "network zone", "security zone", "web zone", "mgmt zone", "management zone",
                 "intranet", "extranet", "internet zone"]


def _is_large_container(value: str, style: str, geom: Optional[ET.Element]) -> bool:
    """Return True if cell looks like a datacenter (large container or DC keyword)."""
    if geom is None:
        return False
    w = float(geom.get("width", 0) or 0)
    h = float(geom.get("height", 0) or 0)

    # Check for swimlane/group style
    parsed = _parse_style(style)
    is_styled_container = "swimlane" in parsed or parsed.get("shape", "").lower() in ("group",)

    # Check for DC keyword in name
    lower_val = _clean_html(value).lower()
    has_dc_keyword = any(kw in lower_val for kw in DC_KEYWORDS)

    # DC if: (swimlane AND large) OR (DC keyword AND large enough)
    if is_styled_container and w > 300 and h > 300:
        return True
    if has_dc_keyword and w > 200 and h > 200:
        return True
    return False


def _is_zone(value: str, style: str, geom: Optional[ET.Element], parent_is_dc: bool) -> bool:
    """Return True if cell is a network zone (medium container or zone keyword)."""
    if geom is None:
        return False
    w = float(geom.get("width", 0) or 0)
    h = float(geom.get("height", 0) or 0)
    size_ok = w > 100 and h > 100

    # Check for swimlane/group style
    parsed = _parse_style(style)
    is_styled_container = "swimlane" in parsed or parsed.get("shape", "").lower() in ("group",)

    # Check for zone keyword in name
    lower_val = _clean_html(value).lower()
    has_zone_keyword = any(kw in lower_val for kw in ZONE_KEYWORDS)

    # Zone if: (keyword AND large enough) OR (styled container inside DC AND large enough)
    if has_zone_keyword and size_ok:
        return True
    if is_styled_container and parent_is_dc and size_ok:
        return True
    # Also match "App Zone", "DB Zone" style names without explicit keyword
    if ("zone" in lower_val) and size_ok:
        return True
    return False


def _parse_tech_arch(root: ET.Element) -> dict:
    """Parse Tech Architecture diagram."""
    datacenters: list[dict] = []
    network_zones: list[dict] = []
    tech_components: list[dict] = []
    network_connections: list[dict] = []

    # Extract 3D Legend info (entity types, zone layers, runtime icons)
    tech_legend = _extract_tech_legend(root)
    entity_type_map = tech_legend.get("entity_type_map", {})
    zone_layer_map = tech_legend.get("zone_layer_map", {})
    icon_deploy_map = tech_legend.get("icon_deploy_map", {})

    # First pass: identify datacenters (large swimlane containers)
    dc_ids: set[str] = set()
    zone_ids: set[str] = set()

    # Collect all cells with their attributes in a single pass
    # Scan BOTH <mxCell> and <object> elements (draw.io uses <object> for cells with metadata)
    cells_info: list[tuple[str, str, str, Optional[ET.Element], str, bool, bool]] = []
    _seen_ids: set[str] = set()
    for cell in root.iter("mxCell"):
        cell_id = cell.get("id", "")
        if cell_id in _seen_ids:
            continue
        _seen_ids.add(cell_id)
        value = cell.get("value", "")
        style = cell.get("style", "")
        parent = cell.get("parent", "")
        geom = cell.find("mxGeometry")
        is_vertex = cell.get("vertex", "0") == "1"
        is_edge = cell.get("edge", "0") == "1"
        cells_info.append((cell_id, value, style, geom, parent, is_vertex, is_edge))
    # Also scan <object> elements — they wrap mxCell and contain label/metadata
    for obj in root.iter("object"):
        obj_id = obj.get("id", "")
        if obj_id in _seen_ids:
            continue
        _seen_ids.add(obj_id)
        # Get label from object attributes (label, c4Name, etc.)
        label = obj.get("label", "")
        if label:
            label = _clean_html(label).strip()
        if not label:
            label = obj.get("c4Name") or obj.get("c4name") or ""
        # Get style/geom from child mxCell
        child_cell = obj.find("mxCell")
        if child_cell is not None:
            style = child_cell.get("style", "")
            parent = child_cell.get("parent", "")
            geom = child_cell.find("mxGeometry")
            is_vertex = child_cell.get("vertex", "0") == "1"
            is_edge = child_cell.get("edge", "0") == "1"
            cells_info.append((obj_id, label, style, geom, parent, is_vertex, is_edge))

    # Build parent→children map
    children_of: dict[str, list[str]] = {}
    for cell_id, value, style, geom, parent, is_vertex, is_edge in cells_info:
        children_of.setdefault(parent, []).append(cell_id)

    # Identify DCs first (large containers in root)
    for cell_id, value, style, geom, parent, is_vertex, is_edge in cells_info:
        if not value or not cell_id:
            continue
        if is_edge or not is_vertex:
            continue
        if _is_large_container(value, style, geom):
            dc_ids.add(cell_id)
            gx = float(geom.get("x", 0) or 0) if geom is not None else 0
            gy = float(geom.get("y", 0) or 0) if geom is not None else 0
            gw = float(geom.get("width", 0) or 0) if geom is not None else 0
            gh = float(geom.get("height", 0) or 0) if geom is not None else 0
            datacenters.append({"id": cell_id, "name": _clean_html(value), "parent_id": parent,
                                "_geom": (gx, gy, gw, gh)})

    # Build parent lookup for ancestor traversal (cell_id → parent_id)
    parent_lookup: dict[str, str] = {}
    for cell_id, value, style, geom, parent, is_vertex, is_edge in cells_info:
        if cell_id:
            parent_lookup[cell_id] = parent

    def _find_ancestor_dc(cell_parent: str) -> Optional[str]:
        """Walk up the parent chain to find the nearest DC ancestor."""
        visited: set[str] = set()
        current = cell_parent
        while current and current not in {"0", "1"} and current not in visited:
            visited.add(current)
            if current in dc_ids:
                return current
            current = parent_lookup.get(current, "")
        return None

    # Identify zones (containers inside DCs or matching zone keywords)
    for cell_id, value, style, geom, parent, is_vertex, is_edge in cells_info:
        if cell_id in dc_ids:
            continue
        if not value or not cell_id:
            continue
        if is_edge or not is_vertex:
            continue
        # Check if any ancestor in the parent chain is a DC
        ancestor_dc = _find_ancestor_dc(parent)
        parent_is_dc = ancestor_dc is not None
        containing_dc_id = ancestor_dc
        # Fallback: geometry containment (zone visually inside DC)
        if not parent_is_dc:
            zone_geom = geom
            zx = float(zone_geom.get("x", 0) or 0) if zone_geom is not None else 0
            zy = float(zone_geom.get("y", 0) or 0) if zone_geom is not None else 0
            zw = float(zone_geom.get("width", 0) or 0) if zone_geom is not None else 0
            zh = float(zone_geom.get("height", 0) or 0) if zone_geom is not None else 0
            for dc in datacenters:
                dx, dy, dw, dh = dc.get("_geom", (0, 0, 0, 0))
                if zx >= dx and zy >= dy and zx + zw <= dx + dw and zy + zh <= dy + dh:
                    containing_dc_id = dc["id"]
                    parent_is_dc = True
                    break

        # Determine layer_type from Legend zone_layer_map (fillColor) or keyword fallback
        zone_fill = _get_fill_color(style)
        layer_type = ""
        if zone_fill and zone_layer_map:
            layer_type = zone_layer_map.get(zone_fill.lower(), "")
        if not layer_type:
            lower_val = _clean_html(value).lower()
            for kw, lt in _ZONE_LAYER_KEYWORDS.items():
                if kw in lower_val:
                    layer_type = lt
                    break

        is_zone_by_rule = _is_zone(value, style, geom, parent_is_dc)

        # Color-based zone detection: if fillColor matches Legend zone_layer_map
        # and the container is large enough (>100x100), treat as a zone even without
        # swimlane style or zone keywords. This catches colored containers like
        # "TDP Shared or Generated Service" (blue=Web Layer) in the diagram.
        is_zone_by_color = False
        if not is_zone_by_rule and layer_type and geom is not None:
            w = float(geom.get("width", 0) or 0)
            h = float(geom.get("height", 0) or 0)
            if w > 100 and h > 100:
                is_zone_by_color = True

        if is_zone_by_rule or is_zone_by_color:
            zone_ids.add(cell_id)
            network_zones.append({
                "id": cell_id,
                "name": _clean_html(value),
                "datacenter_id": containing_dc_id,
                "parent_id": parent,
                "layer_type": layer_type,
            })

    # Build absolute position resolver: walk up parent chain summing offsets
    # (draw.io geometry is relative to parent container)
    cell_geom_raw: dict[str, tuple[float, float, float, float]] = {}
    for cell_id, value, style, geom, parent, is_vertex, is_edge in cells_info:
        if geom is not None:
            cell_geom_raw[cell_id] = (
                float(geom.get("x", 0) or 0), float(geom.get("y", 0) or 0),
                float(geom.get("width", 0) or 0), float(geom.get("height", 0) or 0),
            )

    def _abs_geom(cell_id: str) -> tuple[float, float, float, float]:
        """Resolve absolute geometry by summing parent offsets."""
        if cell_id not in cell_geom_raw:
            return (0, 0, 0, 0)
        rx, ry, rw, rh = cell_geom_raw[cell_id]
        ax, ay = rx, ry
        pid = parent_lookup.get(cell_id, "")
        visited: set[str] = set()
        while pid and pid not in {"0", "1"} and pid not in visited:
            visited.add(pid)
            if pid in cell_geom_raw:
                px, py, _, _ = cell_geom_raw[pid]
                ax += px
                ay += py
            pid = parent_lookup.get(pid, "")
        return (ax, ay, rw, rh)

    # Collect runtime icon cells for proximity matching (small shapes with known deploy icon styles)
    icon_cells: list[dict] = []
    if icon_deploy_map:
        for cell_id, value, style, geom, parent, is_vertex, is_edge in cells_info:
            if is_edge or not is_vertex or geom is None:
                continue
            parsed_s = _parse_style(style)
            shape = parsed_s.get("shape", "")
            matched_mode = ""
            # Check shape key
            if shape and shape in icon_deploy_map:
                matched_mode = icon_deploy_map[shape]
            else:
                # Check image= or stencil parts
                for part in style.split(";"):
                    key = part.strip()
                    if key in icon_deploy_map:
                        matched_mode = icon_deploy_map[key]
                        break
            if matched_mode:
                abs_g = _abs_geom(cell_id)
                icon_cells.append({"geom": abs_g, "deploy_mode": matched_mode, "parent": parent})

    # Also build zone_id → deploy_mode map from icons that are direct children of zones
    zone_deploy_from_icon: dict[str, str] = {}
    for icon in icon_cells:
        pid = icon.get("parent", "")
        if pid in zone_ids:
            zone_deploy_from_icon[pid] = icon["deploy_mode"]

    # Identify tech components (non-container, non-edge vertices inside zones or DCs)
    container_ids = dc_ids | zone_ids
    for cell_id, value, style, geom, parent, is_vertex, is_edge in cells_info:
        if cell_id in container_ids:
            continue
        if not value or not cell_id:
            continue
        if is_edge or not is_vertex:
            continue
        # Skip cells that are direct children of root (id="1") unless they have a parent in containers
        if parent not in container_ids and parent not in {"0", "1"}:
            # Could be inside a zone
            pass
        elif parent in {"0", "1"}:
            # Top-level — skip (likely not a component)
            continue
        parsed = _parse_style(style)
        if "swimlane" in parsed:
            continue
        # Skip edgeLabel cells (protocol/auth labels on connections, not components)
        if "edgeLabel" in style:
            continue
        # Skip text-only cells (no fill, no shape — just floating labels)
        if "text;" in style or parsed.get("shape", "") == "text":
            continue
        clean_val = _clean_html(value).strip()
        if not clean_val:
            continue
        if _is_legend(clean_val):
            continue
        # Skip standalone protocol labels (e.g. "MPLS" icon between DCs)
        if clean_val.lower() in PROTOCOL_LABELS:
            continue
        # Store geometry for containment check
        gx = float(geom.get("x", 0) or 0) if geom is not None else 0
        gy = float(geom.get("y", 0) or 0) if geom is not None else 0
        gw = float(geom.get("width", 0) or 0) if geom is not None else 0
        gh = float(geom.get("height", 0) or 0) if geom is not None else 0

        # Find nearby runtime icon for deploy_mode (Legend-based proximity matching)
        # Use absolute geometry for comparison (icons also use absolute coords)
        icon_mode = ""
        if icon_cells:
            abs_comp = _abs_geom(cell_id)
            icon_mode = _find_nearby_icon_deploy_mode(abs_comp, icon_cells)
        # Fallback: check if parent zone has a known icon
        if not icon_mode and parent in zone_deploy_from_icon:
            icon_mode = zone_deploy_from_icon[parent]

        classification = _classify_component(
            clean_val, style,
            entity_type_map=entity_type_map or None,
            icon_deploy_mode=icon_mode,
        )
        tech_components.append({
            "id": cell_id,
            "name": clean_val,
            "parent_id": parent,
            "zone_id": parent if parent in zone_ids else None,
            "datacenter_id": parent if parent in dc_ids else None,
            "component_type": classification["component_type"],
            "deploy_mode": classification["deploy_mode"],
            "runtime": classification["runtime"],
            "entity_type": classification.get("entity_type", ""),
            "style": style,
            "_geom": (gx, gy, gw, gh),
        })

    # Merge child components into parent containers (geometry containment)
    merged_comp_ids: set[str] = set()
    for parent_comp in tech_components:
        px, py, pw, ph = parent_comp.get("_geom", (0, 0, 0, 0))
        if pw < 150 or ph < 100:  # too small to be a container
            continue
        children_names: list[str] = []
        for child_comp in tech_components:
            if child_comp is parent_comp:
                continue
            if child_comp["id"] in merged_comp_ids:
                continue
            cx, cy, cw, ch = child_comp.get("_geom", (0, 0, 0, 0))
            if cx >= px and cy >= py and cx + cw <= px + pw and cy + ch <= py + ph:
                children_names.append(child_comp["name"])
                merged_comp_ids.add(child_comp["id"])
        if children_names:
            existing = parent_comp.get("name", "")
            parent_comp["name"] = f"{existing} ({', '.join(children_names)})"

    if merged_comp_ids:
        tech_components = [c for c in tech_components if c["id"] not in merged_comp_ids]

    # Clean up _geom
    for c in tech_components:
        c.pop("_geom", None)

    # Build a complete cell_id → name map for all vertex cells with text
    all_cell_names: dict[str, str] = {}
    for cell_id, value, style, geom, parent, is_vertex, is_edge in cells_info:
        if value and cell_id:
            clean = _clean_html(value).strip()
            if clean and len(clean) > 1:
                # Exclude standalone protocol labels from the name map
                if clean.lower() not in PROTOCOL_LABELS:
                    all_cell_names[cell_id] = clean

    # Collect edgeLabel children (protocol/auth labels stored as separate cells)
    tech_edge_labels: dict[str, str] = {}
    for cell in root.iter("mxCell"):
        style = cell.get("style", "") or ""
        parent = cell.get("parent", "")
        value = cell.get("value", "") or ""
        if "edgeLabel" in style and parent and value:
            clean = _clean_html(value).strip()
            if clean and not clean.startswith("%3C"):  # skip encoded XML junk
                if parent in tech_edge_labels:
                    tech_edge_labels[parent] = tech_edge_labels[parent] + " " + clean
                else:
                    tech_edge_labels[parent] = clean

    # Network connections (edges)
    for cell in root.iter("mxCell"):
        if cell.get("edge", "0") != "1":
            continue
        style = cell.get("style", "") or ""
        if "edgeLabel" in style:
            continue
        cell_id = cell.get("id", "")
        value = cell.get("value", "") or ""
        # Merge with edgeLabel if edge value is empty
        raw_label = _clean_html(value).strip()
        if not raw_label and cell_id in tech_edge_labels:
            raw_label = tech_edge_labels[cell_id]
        elif raw_label and cell_id in tech_edge_labels:
            # Edge has value AND edgeLabel — concatenate
            raw_label = raw_label + " " + tech_edge_labels[cell_id]

        src = cell.get("source")
        tgt = cell.get("target")
        # Skip dangling edges (missing source or target — not a real connection)
        if not src or not tgt:
            continue
        # Skip edges connecting to nameless cells (background shapes, decorations)
        if src not in all_cell_names:
            continue
        if tgt not in all_cell_names:
            continue

        # Parse protocol/auth from label e.g. "HTTPS / OAuth2", "JDBC / SSL", "TCP:kafka"
        protocol = None
        auth = None
        if raw_label:
            normalized = re.sub(r"\s*/\s*", "/", raw_label).strip()
            # Check if the full label (or first part) is a compound protocol
            if normalized.lower() in COMPOUND_PROTOCOLS:
                protocol = normalized
            elif "/" in raw_label:
                parts = [p.strip() for p in raw_label.split("/")]
                protocol = parts[0] if parts else None
                auth = parts[1] if len(parts) > 1 else None
            elif ":" in raw_label:
                # Colon-separated format e.g. "TCP:kafka", "HTTPS:OAuth2"
                parts = [p.strip() for p in raw_label.split(":")]
                protocol = parts[0] if parts else None
                auth = parts[1] if len(parts) > 1 else None
            else:
                # Single word label — treat as protocol (e.g. "MPLS", "HTTPS")
                protocol = raw_label.strip() or None

        network_connections.append({
            "source_id": src,
            "target_id": tgt,
            "label": raw_label,
            "protocol": protocol,
            "auth": auth,
        })

    # Clean up internal fields
    for dc in datacenters:
        dc.pop("_geom", None)

    return {
        "datacenters": datacenters,
        "network_zones": network_zones,
        "tech_components": tech_components,
        "network_connections": network_connections,
        "cell_names": all_cell_names,
        "tech_legend": tech_legend,
    }


# ---------------------------------------------------------------------------
# Primary app matching — NorthStar does not use these (they live in EGM's
# architecture_simulation module). Re-exports removed.
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Main entry point (old primary app functions removed — now in architecture_simulation.primary_app_service)
# ---------------------------------------------------------------------------

def parse_drawio_xml(xml_content: str, diagram_type: str) -> dict:
    """Parse a draw.io XML file and extract structured data.

    Args:
        xml_content: Raw XML string (possibly with compressed diagram content).
        diagram_type: "App_Arch" or "Tech_Arch"

    Returns:
        For App_Arch: { "applications": [...], "interactions": [...] }
        For Tech_Arch: { "datacenters": [...], "network_zones": [...],
                         "tech_components": [...], "network_connections": [...] }
    """
    # Decompress if needed
    decompressed = decompress_drawio_content(xml_content)

    # Parse XML — decompressed may be a bare mxGraphModel or full mxfile
    try:
        root = ET.fromstring(decompressed)
    except ET.ParseError:
        # Try wrapping
        try:
            root = ET.fromstring(f"<mxfile>{decompressed}</mxfile>")
        except ET.ParseError:
            if diagram_type == "App_Arch":
                return {"applications": [], "interactions": []}
            return {"datacenters": [], "network_zones": [], "tech_components": [], "network_connections": []}

    if diagram_type == "App_Arch":
        return _parse_app_arch(root)
    elif diagram_type == "Tech_Arch":
        return _parse_tech_arch(root)
    else:
        raise ValueError(f"Unknown diagram_type: {diagram_type!r}. Expected 'App_Arch' or 'Tech_Arch'.")
