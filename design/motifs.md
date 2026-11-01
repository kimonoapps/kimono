# Motifs

The vocabulary Kimono draws from. Nothing enters the UI that is not on this page.

## The rule

**The signature is a mechanic, not a pattern.** It reads something real — how you
are moving, or what the server is actually doing — and responds. Ornament in the
corners is wallpaper no matter how well drawn.

Reference: a Persona theme where Makoto Yuki walks the bottom of the page as you
scroll, and runs when you scroll fast. The point is not a character on the page.
It is a living thing whose behaviour is driven by yours.

Two questions kill most proposals:

1. **What does it read?** Scroll velocity, cursor approach, dwell, which app is
   used most, what the server is doing right now, today's date. "Nothing" means
   decoration.
2. **What does it tell you that you did not already know?** "Nothing" means
   decoration that moves.

Mechanics are not reused between projects. Each app earns its own.

## In use

| Device | Where | Job it holds |
| --- | --- | --- |
| 障子 Shoji screen | Header nav | The current section's screen stands open; the others stay shut |
| 判子 Hanko seal | Admin app state | Stamps whether an app is running, off, or not installed |
| 弁当 Lacquer tray | Admin settings panel | Thick frame and compartments; the label tab turns vermillion where a section needs action |
| 縦書き Tategaki | Admin section labels | Names each compartment down its fold |
| 絵馬 Ema plaque + 紐 cord | Home launcher | Each installed app hangs as a votive plaque |
| お守り Omamori charm | Sign out | The one action that closes something is shaped as a charm |
| 桜紋 Sakura mon | Brand mark | Identity |

## Decoration with no job — candidates for cutting

These exist in the codebase and currently only ornament. Under the rule above
they must earn a job or go.

- **Falling petals** (`.hero-petals`, home hero) — ambient only.
- **Sun disc / colour folds** (`.sun-disc`, `.color-folds`, login art) — ambient only.
- **Account yoke** (`.account-yoke`, profile menu) — a wooden hanger holding a link; the shape carries no meaning the link doesn't already have.

## Candidate mechanics

Each is listed with what it reads and what it tells you.

### 影絵 Shadows on the shoji
The page edges are paper screens. Behind them move the silhouettes of what your
server is actually running — one shadow per app, moving at a rate tied to its
activity. A stopped app's shadow goes still. A crashed one is gone.
*Reads:* live container state. *Tells you:* the health of the whole house at a
glance, without a status list. Extends the shoji already in the nav.

### 猫 The house cat
A cat lives in the portal. It sleeps on the app you open most. It sits and
stares at whatever is broken. It stretches when you save.
*Reads:* usage history, error state, your actions. *Tells you:* where your
attention has been and where it is needed — as position, not text.

### 七十二候 The seventy-two microseasons
Japan divides the year into 72 seasons of about five days, each with a name
("Fine rain moistens the earth"). The portal knows today's and shifts with it —
accent, ambient motion, one line of text.
*Reads:* the date. *Tells you:* the app is never the same twice, and it is
living in a real year rather than a static theme.

### Approach velocity on controls
The Makoto mechanic at component scale. Rush a control with the cursor and it
reacts sharply — panels swing, ink splashes. Approach it slowly and it opens
gently. Applies to every button in the app from one shared signal.
*Reads:* cursor speed and direction. *Tells you:* nothing factual — this one is
pure feel, and only earns a place if it is the loud device.

### The press is the transition
These controls are not instantaneous, and that turns out to be the point. A hold
that takes 1.4s, a joint that slams home over 640ms, a screen that opens in two
stages — none of them are on/off. The duration is dead time only if the press
and the page change are treated as separate events.

So: let the press *become* the transition. The shoji opening is the navigation —
the screens slide back and the destination is already behind them. The joint
driving home is the connect flow completing. The petals filling are the deletion
happening, not a countdown to it.

*Reads:* the press itself. *Tells you:* that the thing you asked for is
underway, with no spinner and no separate page-load state. Kills the loading
indicator as a category.

**Status:** owner's idea, agreed to explore after buttons are cut. Element class
7 (Motion) should be pulled forward or merged into this.

### Wet ink
A setting you just changed shows as wet ink: dark, glossy. Over the next few
minutes it dries to matte.
*Reads:* time since change. *Tells you:* what you touched recently, without
timestamps or a changelog.

## Ruled out

Every rejected specimen lands here with its reason, and is never proposed again.

- **Google Sans Flex, or any of Google's own faces** (type, 2026-10-31). The
  owner wants Kimono to keep an identity of its own; Material's structure and
  motion can be borrowed, its typeface cannot.
- **Kaisei Decol** (type sheet 10, 2026-10-31). Its decoration lives mostly in
  the Japanese; in Kimono's Latin it read as a heavier Mincho and lost to
  Shippori with Zen Maru Gothic.
