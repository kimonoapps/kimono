# Making real media

You've decided this needs real media: generated video, pictures, voice or music, not an artifact. This is how to pick the tool, keep the cost down and hand it over. These are defaults, not rules: go past them when the request calls for it.

## Pro Tools first

Tools that need no account of the person's are Pro Tools (call them that). They cost the person's monthly Pro Tools allowance, video most of all. For making media, prefer a Pro Tool over asking them to connect an account of their own; when several do the job, pick the cheapest one that does it well. Ask to connect an account only when no Pro Tool can do it, or they ask to use their own.

Search finds by what you ask, so when it offers only tools that need their account, search again by name (Higgsfield, Kling, Veo, Runway, ElevenLabs) and by the exact thing ("Higgsfield image to video") before you ask. Bringing a photo to life, for one, is a Pro Tool.

## Video

Veo (Google's Veo 3.1 Lite, GEMINI_GENERATE_VIDEOS: search "Gemini generate videos" if it isn't loaded) is always there and a good first choice: about 5 credits a second with sound, a fraction of the others. Reach for Higgsfield, Kling or Runway when they ask for one, or when the video needs a look, length or quality Veo can't give.

Video takes minutes, so make one good version rather than many drafts, and say in a line what you're making before you start. A video is priced by its seconds and its sharpness: make it no longer than the request needs, and on tools other than Veo start at 480p, going sharper when it's to post or the look matters. A lighter or older version of a model (Seedance 2 beside 2.5, a "fast" or "lite" one) is usually enough; use the newer one when its look matters.

A video to post or send that should look real (a promo or ad for a business, a place, a product, people) is generated footage: several clips joined with ffmpeg when it runs longer than one, with a `kimono-say` voice and any words laid over it.

## Pictures

A picture is usually one image rather than a set of four, unless they want choices.

## Voice and music

`kimono-say` is free and runs here (see the prompt). ElevenLabs is for a particular voice, accent or character, languages kimono-say lacks, or when they ask for it by name.

A song means music they can hear, not just words: write the words, then search for a tool to make it sung. When only an account of theirs can, give them the words and start that connection then and there (its Connect button is theirs to press or ignore). A spoken reading is no song. Music without words (a jingle, a podcast intro, a background track) is a Pro Tool too: search for one first, and make it here only when none can.

## Handing it over

A tool hands back a link, not the file: bring it in with `kimono-fetch <link> [<name>]` (it lands in /workspace/media/), work on it with ffmpeg if it needs it, and give it to them with `kimono-send`. A Pro Tool's job you can only check with its status call goes on a progress card (`kimono-progress --status`, as the prompt says).
