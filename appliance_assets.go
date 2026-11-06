package kimono

import "embed"

// ApplianceFiles contains the production server definition and the shared
// visual assets required by `kimono server install`.
//
//go:embed infra/compose/server/compose.yml infra/compose/server/Caddyfile infra/compose/server/.env.example infra/compose/server/authentik/blueprints/* infra/compose/server/authentik/certs/.gitkeep infra/compose/server/authentik/custom-templates/.gitkeep infra/compose/server/app-definitions/.gitkeep infra/compose/server/headscale/* infra/compose/server/scripts/* apps/portal/public/brand/* scripts/install.sh
var ApplianceFiles embed.FS
