/*
 * Everyday chats scripts/simulate-study.mjs plays out with --set chat: not
 * studying, just someone asking Kimono AI for things. Each is graded on how
 * a great assistant would have handled it: right length and tone, honest,
 * looking up what it can't know, and handing over something ready to use.
 */
export const chatScenarios = [
  {
    id: "quick-questions",
    kind: "chat",
    title: "Quick questions, some about now",
    persona: "Busy parent in Toronto asking quick things between chores. Not technical.",
    voice: "short, lowercase, no punctuation sometimes, one question per message.",
    sessions: [{
      situation: "A few quick questions in a row.",
      turns: 5,
      beats: [
        "Ask how many tablespoons are in a cup.",
        "Ask whether the shops will be open on Remembrance Day this year in Toronto.",
        "Ask what the price of a dozen eggs roughly is in Ontario right now.",
        "Ask who won the most recent Formula 1 race.",
        "Say thanks and end.",
      ],
    }],
    expect: [
      "The tablespoons answer is one line (16), with no search.",
      "Searches for the things that depend on now (holiday hours, current prices, the latest race) instead of guessing or saying it can't know, and says briefly where it found it.",
      "Short answers with no preamble, no recaps and no 'let me know if you need anything else'.",
      "Never mentions tools, commands or how it works.",
    ],
  },
  {
    id: "farewell-card",
    kind: "chat",
    title: "A card message, then changes",
    persona: "Office worker writing in a coworker's leaving card. Coworker is Priya, leaving after 6 years to move to Vancouver; she ran the Friday quiz.",
    voice: "normal casual typing, full sentences, a bit rushed.",
    sessions: [{
      situation: "Writing a message in Priya's farewell card.",
      turns: 5,
      beats: [
        "Ask for a message for Priya's leaving card. Mention six years, Vancouver and the Friday quiz.",
        "Say it's too long, it has to fit in a small card.",
        "Ask for it a bit funnier.",
        "Say perfect, thanks.",
      ],
    }],
    expect: [
      "Gives a message ready to copy straight into the card, with no placeholders it could fill itself and no commentary around it beyond a line.",
      "Shorter really means short (a couple of lines), and funnier stays warm and fitting for a workplace.",
      "Doesn't ask unnecessary questions first; uses the details given.",
    ],
  },
  {
    id: "rent-increase",
    kind: "chat",
    title: "Worried about a rent increase",
    persona: "Tenant in Ontario, stressed: landlord just told them rent goes up 12% from January. Lives in an apartment first occupied in 2015.",
    voice: "anxious, long run-on sentences, some typos.",
    sessions: [{
      situation: "Their landlord announced a 12% rent increase.",
      turns: 6,
      beats: [
        "Say your landlord is raising rent 12% in January and ask if that's even legal, you're freaking out.",
        "Answer any questions it asks (building first occupied 2015, you got the notice by email two weeks ago).",
        "Ask what you should actually do.",
        "Ask it to write the message to the landlord for you.",
        "Say thanks, you feel better.",
      ],
    }],
    expect: [
      "Acknowledges the worry briefly and warmly, without overdoing it, then helps.",
      "Looks up Ontario's current rules (the rent increase guideline for this year, the exemption for units first occupied after November 15, 2018, and the 90-day written notice requirement) rather than answering from memory, and says where it's from.",
      "Gets the key point right: a 2015 unit is under rent control, so 12% is above the guideline, and an email two weeks ahead isn't proper notice.",
      "The message to the landlord is ready to send, calm and firm, with only the truly unknown details left as blanks.",
      "Plain words, not legalese; suggests the Landlord and Tenant Board or a legal clinic where that helps.",
    ],
  },
  {
    id: "lisbon-trip",
    kind: "chat",
    title: "Planning a family trip, then a printout",
    persona: "Parent planning 3 days in Lisbon in mid-December with two kids (6 and 9). Not a planner, wants it simple.",
    voice: "friendly, medium-length messages, emojis now and then.",
    sessions: [{
      situation: "Planning a 3-day Lisbon trip in December with kids.",
      turns: 5,
      beats: [
        "Ask for a plan for 3 days in Lisbon with your kids (6 and 9) in mid-December.",
        "Ask whether there's anything Christmassy on then.",
        "Say the kids hate long walks, can it adjust.",
        "Ask for it as something you can print.",
        "Say thanks.",
      ],
    }],
    expect: [
      "A plan that's easy to scan, sensibly paced for young kids, not an essay.",
      "Looks up what's actually on in December (Christmas markets, lights, seasonal opening hours) instead of inventing it, and says where it found it.",
      "Adjusts the plan for less walking (trams, taxis, fewer stops) without starting over or lecturing.",
      "For the printout, sends a real file (a PDF or document), not just a message saying where it is.",
    ],
  },
  {
    id: "wifi-help",
    kind: "chat",
    title: "Not-technical tech help",
    persona: "Retired grandmother whose laptop wifi keeps dropping. Uses Windows 11. Very non-technical.",
    voice: "polite, full sentences, signs off with 'Thank you, Margaret'. Doesn't know technical words.",
    sessions: [{
      situation: "The laptop's wifi keeps disconnecting.",
      turns: 6,
      beats: [
        "Explain that the internet on your laptop keeps going off and on and ask what to do.",
        "Follow its first step, and say what happened (it helped for a bit, then it dropped again).",
        "Say you don't know what 'adapter' or 'router' means if it uses those words.",
        "Try the next step it gives you and say it seems to be working now.",
      ],
    }],
    expect: [
      "Plain words, explaining any technical word the moment it's needed.",
      "One or two steps at a time, waiting to hear how they went, rather than a wall of twenty fixes.",
      "Patient and kind, never condescending.",
    ],
  },
  {
    id: "budget",
    kind: "chat",
    title: "Where does my money go",
    persona: "Young adult trying to save, pastes a month of spending. Not good with numbers.",
    voice: "casual, lowercase, 'lol', 'ngl'.",
    sessions: [{
      situation: "Their October spending: rent 1450, groceries 390, uber eats 268, uber rides 112, spotify 12, netflix 18, disney+ 15, gym 60 (went twice), phone 75, coffee 94, amazon 210, bar nights 180, gas 0 (no car), gifts 40. Take-home pay 3300.",
      turns: 5,
      beats: [
        "Paste the list of spending and ask where your money is going, ngl you feel broke.",
        "Ask what to cut to save 300 a month.",
        "Ask for something you can look at to keep track next month.",
        "Say thanks.",
      ],
    }],
    expect: [
      "Adds the numbers up correctly (2924 spent of 3300) and says where most of it goes, briefly and without judgement.",
      "Shows a picture of the breakdown (a chart) when it helps, without being asked.",
      "Concrete cuts that reach 300 (delivery, subscriptions, the gym they barely use), with the arithmetic right.",
      "Something useful to track next month (a tracker artifact or a spreadsheet file).",
    ],
  },
];
