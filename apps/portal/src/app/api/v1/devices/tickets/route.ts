import { apiJson, apiUser, crossSite, unauthorized } from "@/lib/api-v1";
import { createTicket } from "@/lib/kimono-read";
import { readFailure } from "../errors";

/**
 * Setting up a Kimono Read from the phone: a one-time ticket, and the address
 * of the setup page the reader serves on its own hotspot, with this Kimono's
 * address and the ticket filled in. The phone opens it once it has joined the
 * reader's "Kimono Read" Wi-Fi; the person only picks their Wi-Fi and its
 * password there.
 */
export async function POST(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  try {
    const { ticket, expiresIn } = createTicket(user.username);
    const server = (process.env.KIMONO_PORTAL_URL || new URL(request.url).origin).replace(/\/+$/, "");
    const setupUrl = `http://192.168.4.1/kimono?server=${encodeURIComponent(server)}&ticket=${encodeURIComponent(ticket)}`;
    return apiJson({ ticket, server, setupUrl, expiresIn }, 201);
  } catch (error) { return readFailure(error); }
}
