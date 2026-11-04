import { apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { crestColourNames, crestColours, crestKinds, crestNames, crestSvg } from "@kimono/ui/crest";

/** Every crest and colour a space can have, each drawn, for pickers. */
export async function GET() {
  const user = await apiUser();
  if (!user) return unauthorized();
  return apiJson({
    crests: crestNames.map((id) => ({ id, jp: crestKinds[id].jp, name: crestKinds[id].name })),
    colors: crestColourNames.map((id) => ({ id, ...crestColours[id] })),
    marks: Object.fromEntries(crestNames.map((crest) => [crest, Object.fromEntries(crestColourNames.map((colour) => [colour, crestSvg(crest, colour)]))])),
  });
}
