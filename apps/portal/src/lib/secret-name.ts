/** The name a Kimono app's secret is kept under, such as KIMONO_SECRET_FORGEJO_AI_TOKEN. */
export function secretName(appId: string, key: string) { return `KIMONO_SECRET_${appId}_${key}`.toUpperCase().replaceAll("-", "_"); }
