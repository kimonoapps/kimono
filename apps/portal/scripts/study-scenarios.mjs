/*
 * The study sessions scripts/simulate-study.mjs plays out. Each is a student
 * (who they are and how they write), one or more chats (a later chat is a new
 * one, to see what carried over), loose beats for the student to follow, and
 * what an excellent tutor would do, for the grader. Every one has a moment
 * where a picture would help that the student never asks for.
 */
export const scenarios = [
  {
    id: "em-waves",
    title: "EM waves homework (the real failure)",
    persona: "Year 12 / first-year uni student doing an online Moodle physics assignment. Weak on the basics, anxious, wants to actually learn because there's a test next week.",
    voice: "lowercase, short, typos, 'bro', 'idk', 'pls'. Gives numbers tersely like '2.9979 e8' without saying what they are.",
    sessions: [
      {
        situation: "Question 3 of a Moodle assignment: light from Proxima Centauri in vacuum, magnetic field amplitude 43.7 nT, f = 1.51 × 10^14 Hz. (a) E amplitude in V/m, (b) angular frequency in rad/s, (c) wavelength in µm, (d) average intensity in W/m².",
        turns: 12,
        beats: [
          "Paste the whole question (all four parts, with numbers) and say you don't understand anything and need to learn it.",
          "Right after its first reply, say: don't tell me the answers, I want to learn.",
          "If it still explains everything for you, complain that you're not learning, it's just giving you info.",
          "Answer its questions tersely; say 'idk' to at least one. When asked for the speed of light, reply only '2.9979 e8 m/s'.",
          "Admit you can't picture how the electric and magnetic parts of light are 'linked' or what an amplitude even is.",
          "Get part (a) right with its help, then try (c) and make a units mistake (forget the 10^-6 for µm).",
          "For (d), ask why it's the 'average' intensity and what the 2 is for.",
        ],
      },
      {
        situation: "Two days later, a new chat: a different EM-wave question from the same course, an electric field amplitude of 220 V/m at 2.4 GHz (find B amplitude, wavelength, intensity).",
        turns: 6,
        beats: [
          "Paste the new question with no greeting. Do NOT repeat that you want hints rather than answers.",
          "If it gives you the answers straight away, say 'bro i told you before i want to learn'.",
          "Try part one yourself and get it right.",
        ],
      },
    ],
    expect: [
      "After 'don't give me answers' it switches to guiding: one small question at a time, waiting for the student.",
      "Keeps track of which part of question 3 they're on even when the student sends a bare number.",
      "When the student can't picture E and B, it draws the wave (E and B perpendicular, in phase, amplitudes, wavelength) without being asked.",
      "Catches the µm units slip and helps them find it rather than correcting it outright.",
      "Explains the average and the 1/2 (sin² averages to 1/2), ideally with a picture of the oscillating intensity.",
      "Keeps 'wants to learn, not be given answers' as a memory and, in the new chat, guides from the start.",
    ],
  },
  {
    id: "related-rates",
    title: "Calculus: related rates (ladder)",
    persona: "First-year engineering student, decent at algebra, lost on related rates. English is their second language.",
    voice: "simple English with small grammar mistakes, no capitals at the start, polite ('sorry', 'thank you').",
    sessions: [
      {
        situation: "A 5 m ladder leans on a wall. The bottom slides away at 0.4 m/s. How fast is the top sliding down when the bottom is 3 m from the wall?",
        turns: 10,
        beats: [
          "Give the problem and say you know derivatives but don't know how to start this kind of problem.",
          "Early on, say: please use simple words, my english is not so good.",
          "Say you don't understand why x and y both change, or which one is dx/dt.",
          "Differentiate x² + y² = 25 but forget the chain rule (write 2x + 2y = 0).",
          "Get a negative answer and ask why it's negative, did you do something wrong.",
          "At the end ask for a similar problem to practise.",
        ],
      },
    ],
    expect: [
      "Uses short sentences and plain words from when the student asks, all the way through.",
      "Draws the ladder, wall and ground with x, y and the 5 m labelled (ideally moving, or with a slider) when the student can't see what's changing.",
      "Catches the missing dx/dt, dy/dt and has the student fix it.",
      "Explains the negative sign as the top moving down, ideally pointing at the picture.",
      "Gives a fresh practice problem without the answer.",
    ],
  },
  {
    id: "equilibrium-quiz",
    title: "Chemistry: Le Chatelier revision quiz",
    persona: "Year 11 chemistry student revising for a test tomorrow. Learns by being tested, gets bored with long explanations.",
    voice: "casual, short, emojis sometimes, 'wait what', 'ohhh'.",
    sessions: [
      {
        situation: "Revising chemical equilibrium and Le Chatelier's principle for a test tomorrow (N2 + 3H2 ⇌ 2NH3, exothermic).",
        turns: 10,
        beats: [
          "Ask it to help you revise Le Chatelier for your test tomorrow.",
          "Say: quiz me, one question at a time, don't dump everything.",
          "Get the pressure question right, but get the temperature one wrong (think heating shifts it to the products).",
          "Say you don't get what 'shifts left' even looks like, or what happens to the concentrations over time.",
          "Ask what happens if you add a catalyst; be sure it shifts the equilibrium.",
          "Ask for a quick summary you can look at tonight.",
        ],
      },
    ],
    expect: [
      "Asks one question at a time and waits, from when the student asks, all the way through.",
      "Corrects the temperature misconception by reasoning through it (exothermic, so heat is a product) rather than just giving the rule.",
      "When they can't picture a shift, shows concentration-vs-time graphs (a disturbance, then the new equilibrium) without being asked.",
      "Clears up the catalyst misconception (speeds both ways equally, no shift).",
      "The end-of-session summary is short and scannable (could be a one-page artifact).",
    ],
  },
  {
    id: "respiration-adhd",
    title: "Biology: cellular respiration, short answers",
    persona: "Year 10 biology student with ADHD who loses focus on long text. Has a worksheet due.",
    voice: "very short messages, 'ok', 'wait', 'too long', sometimes changes subject then comes back.",
    sessions: [
      {
        situation: "A worksheet on cellular respiration: the stages (glycolysis, Krebs cycle, electron transport chain), where each happens, and the ATP made.",
        turns: 10,
        beats: [
          "Say you have a worksheet on cellular respiration and don't get it.",
          "After its first reply (if it's longer than a few lines), say: too long. i have adhd keep it short pls.",
          "Mix up glycolysis and the Krebs cycle: say the Krebs cycle happens in the cytoplasm.",
          "Say you can't keep track of what goes in and out of each stage.",
          "Wander off: ask something random (whether mitochondria have their own DNA), then come back.",
          "Ask: so how much ATP in total.",
        ],
      },
    ],
    expect: [
      "Keeps every reply short once asked, including explanations later on.",
      "Fixes the location mix-up (glycolysis in the cytoplasm, Krebs in the mitochondrial matrix).",
      "Shows a simple flow diagram of the three stages with inputs and outputs when the student can't keep track, without being asked.",
      "Answers the tangent briefly, then steers back to the worksheet.",
      "Gives an ATP total with the usual caveat (about 30–38) without a wall of text.",
      "Keeps 'prefers short answers' as a memory.",
    ],
  },
  {
    id: "z-scores",
    title: "Statistics: normal distribution and z-scores",
    persona: "Psychology undergrad in a required stats course, a bit maths-anxious, good at following worked examples.",
    voice: "full sentences, a bit apologetic, 'sorry if this is a dumb question'.",
    sessions: [
      {
        situation: "Exam scores are normal with mean 70 and standard deviation 8. What proportion of students score above 82? Between 62 and 78?",
        turns: 10,
        beats: [
          "Give the problem and say you know the formula for z but don't know what to do with it after.",
          "Compute z for 82 wrong (get (82-70)/8 = 1.25).",
          "Ask why the area under the curve is a probability, it doesn't make sense to you.",
          "Read the table value for z = 1.5 as the answer for 'above 82' (forget to subtract from 1).",
          "Say you learn best from seeing examples worked through.",
          "Try 'between 62 and 78' yourself.",
        ],
      },
    ],
    expect: [
      "Catches the arithmetic slip (12/8 = 1.5) and lets the student find it.",
      "Shows the bell curve with the area above 82 shaded (ideally interactive) when the area/probability idea is confusing, without being asked.",
      "Uses the picture to explain why it's 1 minus the table value.",
      "Switches to worked examples after the student says that's how they learn.",
      "Lets the student do 62–78 and checks it, noting the 68% rule.",
    ],
  },
  {
    id: "essay-coach",
    title: "History: WW1 causes essay (don't write it for me)",
    persona: "Year 11 history student with an essay due Friday on the causes of WW1. Wants their own essay, worried about AI detection, has a lot of notes but no structure.",
    voice: "normal texting, some caps for emphasis, 'like', 'ngl'.",
    sessions: [
      {
        situation: "Essay question: 'To what extent was the assassination of Franz Ferdinand the main cause of WW1?' They have notes on militarism, alliances, imperialism, nationalism (MAIN) and the July Crisis.",
        turns: 9,
        beats: [
          "Explain the essay question and say you have notes but no idea how to structure it.",
          "Say clearly: DON'T write it for me, I want it to be my own work.",
          "Say you get confused about who was allied with whom and how it all chained together in July 1914.",
          "Write a weak thesis yourself ('There were many causes of WW1') and ask if it's good.",
          "Ask what order your body paragraphs should go in.",
          "Paste one paragraph you wrote (a few sentences, one factual error: say Britain declared war on Germany because of Russia) and ask for feedback.",
        ],
      },
    ],
    expect: [
      "Never writes essay text for them; helps them build structure and their own thesis through questions.",
      "When they're confused about alliances and the July Crisis chain, shows a timeline or alliance diagram without being asked.",
      "Pushes the weak thesis towards an arguable 'to what extent' position without writing it for them.",
      "Catches the factual error (Britain entered over Belgian neutrality) and asks them to check it.",
      "Keeps 'doesn't want work written for them' as a memory.",
    ],
  },
];
