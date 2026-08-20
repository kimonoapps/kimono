#!/bin/sh
set -eu

repository="${KIMONO_REPOSITORY:-kimonoapps/kimono}"
download_base="${KIMONO_DOWNLOAD_BASE:-https://github.com/${repository}/releases/latest/download}"
install_path="${KIMONO_INSTALL_PATH:-/usr/local/bin/kimono}"

if [ "$(uname -s)" != "Linux" ]; then
  echo "Kimono currently supports Linux servers and nodes only." >&2
  exit 1
fi

case "$(uname -m)" in
  x86_64|amd64) architecture="amd64" ;;
  aarch64|arm64) architecture="arm64" ;;
  *)
    echo "Unsupported CPU architecture: $(uname -m)" >&2
    exit 1
    ;;
esac

if [ "$(id -u)" -ne 0 ] && [ "${KIMONO_ALLOW_UNPRIVILEGED:-0}" != "1" ]; then
  echo "Run this installer as root (for example: curl ... | sudo sh)." >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required to install Kimono." >&2
  exit 1
fi

temporary_directory=$(mktemp -d)
trap 'rm -rf "$temporary_directory"' EXIT HUP INT TERM

asset="kimono_linux_${architecture}"
curl -fsSL --retry 3 --proto '=https' --tlsv1.2 \
  "${download_base}/${asset}" \
  -o "${temporary_directory}/${asset}"
curl -fsSL --retry 3 --proto '=https' --tlsv1.2 \
  "${download_base}/SHA256SUMS" \
  -o "${temporary_directory}/SHA256SUMS"

expected=$(awk -v name="$asset" '$2 == name { print $1 }' "${temporary_directory}/SHA256SUMS")
if [ -z "$expected" ]; then
  echo "The release checksum does not contain ${asset}." >&2
  exit 1
fi
actual=$(sha256sum "${temporary_directory}/${asset}" | awk '{ print $1 }')
if [ "$actual" != "$expected" ]; then
  echo "Kimono download checksum verification failed." >&2
  exit 1
fi

install -m 0755 "${temporary_directory}/${asset}" "$install_path"
echo "Installed $($install_path version) at ${install_path}."

prompt() {
  label=$1
  default=${2:-}
  if [ ! -r /dev/tty ]; then
    echo "Interactive input is unavailable. Pass server/node options on the command line." >&2
    exit 1
  fi
  if [ -n "$default" ]; then
    printf '%s [%s]: ' "$label" "$default" >/dev/tty
  else
    printf '%s: ' "$label" >/dev/tty
  fi
  IFS= read -r answer </dev/tty
  if [ -z "$answer" ]; then
    answer=$default
  fi
  printf '%s' "$answer"
}

if [ "$#" -eq 0 ]; then
  echo
  echo "What kind of Kimono VM is this?"
  echo "  1) Main server (Authentik + Headscale)"
  echo "  2) Client node (Tailscale mesh access)"
  echo "  3) Install the CLI only"
  role=$(prompt "Choose 1, 2, or 3" "1")
  case "$role" in
    1|server) set -- server ;;
    2|node) set -- node ;;
    3|cli) set -- cli ;;
    *)
      echo "Unknown selection: $role" >&2
      exit 1
      ;;
  esac
fi

if [ "$1" = "server" ]; then
  shift
  if [ "$#" -eq 0 ]; then
    domain=$(prompt "Public base domain (for example, kimonolabs.dev)")
    portal_host=$(prompt "Kimono Portal name (@ for apex, a short label, or full hostname)" "www")
    email=$(prompt "Certificate email")
    if [ -z "$domain" ] || [ -z "$email" ]; then
      echo "Domain and email are required." >&2
      exit 1
    fi
    case "$portal_host" in
      @) portal_domain="$domain" ;;
      *.*) portal_domain="$portal_host" ;;
      *) portal_domain="${portal_host}.${domain}" ;;
    esac
    dynamic_dns=$(prompt "Configure Cloudflare Dynamic DNS? (y/N)" "n")
    case "$dynamic_dns" in
      y|Y|yes|YES)
        "$install_path" server install --domain "$domain" --portal-domain "$portal_domain" --email "$email" --no-start
        "$install_path" server cloudflare-ddns setup
        exec "$install_path" server start
        ;;
    esac
    set -- --domain "$domain" --portal-domain "$portal_domain" --email "$email"
  fi
  exec "$install_path" server install "$@"
fi

if [ "$1" = "node" ]; then
  shift
  if [ "$#" -eq 0 ]; then
    server_url=$(prompt "Kimono mesh URL (for example, https://mesh.example.com)")
    default_machine=$(hostname 2>/dev/null || printf 'node')
    machine=$(prompt "Machine name" "$default_machine")
    if [ -z "$server_url" ] || [ -z "$machine" ]; then
      echo "Mesh URL and machine name are required." >&2
      exit 1
    fi
    set -- --server "$server_url" --name "$machine"
  fi
  exec "$install_path" node install "$@"
fi

if [ "$1" != "cli" ]; then
  echo "Unknown installer role: $1 (expected server, node, or cli)" >&2
  exit 1
fi

echo "CLI installed. Run 'sudo kimono server install' or 'sudo kimono node install' when ready."
