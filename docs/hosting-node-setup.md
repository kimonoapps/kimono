# Set up a Kimono Hosting node

Kimono automates the TLS certificate. Pelican still owns Wings itself: install
Wings once, create the node in Kimono Hosting, and apply the configuration the
panel generates. Joining the Kimono private mesh is optional.

## 1. Point DNS at the node

Create a **DNS-only** record such as:

```text
node2.kimonolabs.dev -> NODE_PUBLIC_IP
```

Forward TCP `8080` to the node. Port `443` is not required.

## 2. Install the Kimono CLI

```bash
curl -fsSL https://raw.githubusercontent.com/kimonoapps/kimono/main/scripts/install.sh | \
  sudo sh -s -- cli
```

## 3. Let Kimono configure HTTPS

Recommended for Cloudflare DNS because it does not need ports `80` or `443`:

```bash
sudo install -m 0600 /dev/null /root/cloudflare-dns-token
sudo nano /root/cloudflare-dns-token

sudo kimono node hosting tls \
  --hostname node2.kimonolabs.dev \
  --email you@example.com \
  --challenge cloudflare \
  --cloudflare-token-file /root/cloudflare-dns-token
```

The Cloudflare token only needs **Zone / DNS / Edit** access for the domain.
Kimono installs Certbot, obtains the certificate, configures renewal, and
restarts Wings after future renewals.

If TCP `80` is forwarded to this node, the shorter HTTP flow also works:

```bash
sudo kimono node hosting tls \
  --hostname node2.kimonolabs.dev \
  --email you@example.com
```

## 4. Finish in Kimono Hosting

Install Docker and Wings by following Pelican's short
[Wings installation page](https://pelican.dev/docs/wings/install/). Kimono does
not replace or fork Wings.

In the panel, create the node with:

```text
FQDN:        node2.kimonolabs.dev
Scheme:      HTTPS
Daemon port: 8080
Behind proxy: No
```

Open the node's **Configuration** tab and run its **Auto Deploy Command** on
the node. That installs the panel-generated Wings configuration. Start Wings,
then verify everything:

```bash
sudo systemctl enable --now wings
sudo kimono node doctor
sudo kimono node status
```

The finished Wings endpoint is `https://node2.kimonolabs.dev:8080`.

> Multiple nodes behind one public IP need different forwarded Wings ports,
> such as `8080`, `8081`, and `8082`. Pass the matching port to
> `kimono node hosting tls --port PORT` and enter that same port in the panel.
