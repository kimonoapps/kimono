"""Cases 1-6: odd wording that must survive verbatim."""
import re

from common import BOOK_CSS, Book, catchwords, esc, save_book, tmp, out, weasy

NOTO = '/usr/share/fonts/truetype/noto/NotoSerif-Regular.ttf'


# 1 ---------------------------------------------------------------------------
def archaic():
    b = Book('archaic', 'A Trve and Faithfvll Relation of the Olde Shoppe at Saint Botolphs Gate', 'I. W. Gent.',
             'Early Modern English pastiche: u/v and i/j swaps, long s, &c., ye/vnto/doth, catchwords and marginal notes.')
    b.html('<section class="tp">')
    for cls, line in [
        ('t1', 'A TRVE AND FAITHFVLL RELATION OF THE OLDE SHOPPE AT SAINT BOTOLPHS GATE'),
        ('t2', 'Wherein is ſhewed the ſtrange Clocke that would not ſtrike, the Cat that kept the Booke, &amp; diuers other Matters worthy the noting.'),
        ('t3', 'Written by I. W. Gent.'),
        ('t4', 'LONDON, Printed for the Author, and are to be ſold at his Shoppe, 1611.'),
    ]:
        b.p(line, cls=cls)
    b.html('</section>')
    b.chapter('To the Reader.')
    b.p('GEntle Reader, I haue here ſet downe, as neere as my poore wit could reach vnto it, a trewe accompt of the olde '
        'Shoppe that ſtood at Saint Botolphs Gate, and of the ſtrange doings therein. If thou finde ought amiſſe, blame not '
        'the Printer, who is an honeſt man &amp; a ſober, but the Author, who is neither ſo learned nor ſo ſober as he would be. '
        'And ſo I commit thee to God, and this little Booke to thy charitie. Farewell.', cls='noindent')
    b.chapter('Chap. I. Of the Shoppe, and of him that kept it.')
    b.p('There was in the Citie of London, hard by Saint Botolphs Gate, an olde Shoppe of ſmall ſtature but great repute, '
        'ouer whoſe dore did hang a painted boord, whereon was written in letters of gold YE OLDE SHOPPE OF THE THREE KEYES. '
        'The keeper thereof was one Maiſter Humfrey Pettigrewe, a Clocke-maker by his trade, and by his nature a talker, for he '
        'would diſcourſe vnto any man that ſtayed but a moment, of the motions of the Heauens, of the price of Sea-coale, of the '
        'Spaniard, &amp;c. &amp;c., ſo that his neighbours ſaid of him, that his tongue was the onely engine in all the Shoppe that '
        'neuer wanted mending.')
    b.p('Now ye ſhall vnderſtand, that this Shoppe was not as other ſhoppes be.[[sn:The Cat that kept the Booke.]] For it had in it a Cat, '
        'blacke as a Chimney-ſweepe, which did ſit vpon the great Booke of Accompts all the day long, and would ſuffer no man to '
        'open it ſaue her maiſter; and if any Prentice made bold to lift the couer, ſhe would ſtrike at his hand, as who ſhould '
        'ſay, Thou art not of the Myſterie. Whereof Maiſter Pettigrewe was right glad, for he ſaid the Cat kept his reckonings '
        'better than his wife, and asked leſſe wages, and was neuer abed with the ague.')
    b.p('It doth ſeeme a ſmall matter to write of, yet I hold it worth the telling, for I haue heard it reported by honeſt men, '
        'and by ſome that were not honeſt, which in a manner confirmeth it, ſeeing that they did all agree. And I my ſelfe haue '
        'ſeene the Cat, though ſhe would not ſuffer me to ſee the Booke, which I take to be a ſigne of her diſcretion rather than '
        'of my want of credit.')
    b.chapter('Chap. II. How the Clocke was mended, or rather not mended.')
    b.p('Vpon a Thurſday in Lent there came into the Shoppe a Gentleman of the Countie of Kent, very braue in his apparell, bearing '
        'vnder his arme a Clocke of the Dutch faſhion, which (as he ſaid) had not ſtrooke the houre theſe ſeuen yeeres, &amp; yet kept '
        'the time moſt iuſtly. Maiſter Pettigrewe tooke it in his hands, and turned it about, and held it to his eare, and ſaid, '
        'Sir, here is a Clocke that hath more wit than moſt men, for it knoweth the houre and will not tell it.')
    b.p('The Gentleman was not pleaſed with this anſwere, and bade him mend it preſently, or he would haue the Law vpon him.'
        '[[sn:A Clocke that would not ſtrike.]] Whereupon the Clocke-maker opened the backe of it, and found therein, wrapt in a '
        'little paper, a lock of ſome Ladies haire, and a writing in a womans hand which ſaid onely, Strike not till I come againe. '
        'At which the Gentleman grew pale, and payed his ſixpence, and went his way without his Clocke; and it ſtandeth in the '
        'Shoppe to this day, and hath neuer ſtrooke, and neuer ſhall, as I beleeue.')
    b.p('Thus much for the Clocke. Of the Prentice that was made a Conſtable, of the great Froſt, of the Dogge that could tell '
        'money, &amp;c., I ſhall write hereafter, if God ſend me life and the Printer ſend me paper. In the meane ſeaſon, let the '
        'Reader that hath a Clocke which will not ſtrike be content therewith, for there be worſe things in a houſe than ſilence.')
    b.chapter('Chap. III. A Song that was ſung at the Shoppe dore.')
    b.verse('''Come buy, come buy, ye Gallants all,
  Come buy at Pettigrewes;
Here's Clockes that ſtrike, and Clockes that call,
  And one that will refuſe.

The Cat doth keepe the Booke of Debts,
  The Maiſter keepes the Dore;
And he that neuer payes his debts
  Shall neuer come no more.

Then buy, then buy, ere Candle-light,
  The Shoppe ſhuts vp at Nine;
Your Coyne is yours but for to night,
  To morrow it is mine.''')
    b.p('FINIS.', cls='finis')
    css = BOOK_CSS + """
    @page { @top-center { content: 'A Trve Relation.'; font: italic 9pt 'Noto Serif'; } @bottom-center { content: none } }
    @page :first { @top-center { content: none } }
    html { font-size: 11.5pt; }
    .tp { text-align: center; padding-top: 10mm; }
    .tp p { text-align: center; text-indent: 0; margin-bottom: 1.4em; }
    .t1 { font-size: 17pt; line-height: 1.3; letter-spacing: 0.04em; }
    .t2 { font-style: italic; }
    .t3 { font-size: 12pt; margin-top: 3em; }
    .t4 { font-size: 9.5pt; margin-top: 8em; border-top: 0.6pt solid #000; padding-top: 0.6em; }
    h1 { font-size: 13pt; font-style: italic; border-bottom: 0.6pt solid #000; padding-bottom: 0.4em; }
    .side { float: right; width: 24mm; margin-right: -28mm; font-size: 7.5pt; font-style: italic; text-indent: 0; text-align: left; line-height: 1.2; }
    @page { margin-right: 30mm; }
    .finis { text-align: center; text-indent: 0; margin-top: 2em; letter-spacing: 0.2em; }
    """
    raw = tmp('archaic-raw.pdf')
    weasy(b.document(css), raw)
    catchwords(raw, out('archaic.pdf'), NOTO, size=10.5, right=30)
    save_book(b, out('archaic.pdf'),
              notes='Long s (U+017F) is used throughout most of the text; truth keeps it. Each page has a printer\'s catchword '
                    '(first word of the next page) bottom right and a running head: both are page furniture, not in truth. '
                    'The two marginal notes are counted in "notes" and placed in truth after their chapter. No page numbers.',
              must_keep=['GEntle Reader', 'vnto', 'olde', 'Shoppe', 'YE OLDE SHOPPE OF THE THREE KEYES', 'Now ye ſhall',
                         'doth', '&c. &c.', 'ſtrooke', 'Maiſter Humfrey Pettigrewe', 'Thurſday', 'iuſtly', 'beleeue',
                         'Shall neuer come no more.', 'To morrow it is mine.', 'diuers', 'accompt'])


# 2 ---------------------------------------------------------------------------
def dialect_diary():
    b = Book('dialect-diary', 'Brackwater Tales', 'Morwenna Tregear',
             'Rural West Country dialect and teenage slang in dialogue, then a child\'s diary full of deliberate misspellings.')
    b.chapter('Up Brackwater Lane')
    b.ps('''
"Thee bain't gwain down Brackwater Lane wi'out thy boots, maid," said old Ezra Hollin, leaning on the gate with his pipe turned upside-down against the drizzle. "Tha'll be up to thy knees in it afore t'church clock strikes. 'Tis allus the same when the Brack do rise."

Kezia, who was fifteen and had been in Brackwater for exactly two days, looked down at her white trainers and then up at her great-grandfather. "It's literally a puddle, Grandad. It's fine. I'm not even being funny."

"A puddle, is it?" Ezra took the pipe out of his mouth and pointed the stem at the lane. "Thy great-gran'mother said 'zackly that in nineteen-and-fifty-two, an' us 'ad to fetch 'er out wi' a hay-rake. Gurt soft lummock. Wet as a shag she were, an' twice as cross."

Her cousin Deshawn, who had come out to see what the shouting was about, leaned on the other side of the gate. "Nah, he's got a point, Kez. That ain't a puddle, that's a whole river, fam. You're gonna get your creps mashed up, no cap."

"Creps?" said Ezra.

"Shoes, innit," said Deshawn. "Trainers. Proper peng ones and all. She'll be vexed."

"Ah." Ezra nodded slowly, as if he had been told something of great importance by a foreign ambassador. "Well, thee tell 'er, then, in thy own tongue, for 'er dun't 'eed mine. Tell 'er the Brack 'ave took better creps than 'ers. Tell 'er it took Jarge Pinnock's bull in 'sixty-eight an' us never seed 'im agin, only 'is bell, an' that come up in Crediton market a twelvemonth arter, an' Jarge 'ad to buy 'n back."

"He bought his own bell back?" said Kezia. "That's so long."

"Long it were," said Ezra with satisfaction. "Took 'im all mornin' to argify the price."

Deshawn laughed so hard he had to hold on to the gatepost. Kezia rolled her eyes, but she went back inside for her wellies all the same, and when she came out again the old man was still chuckling to himself and saying under his breath, "Creps. Dang me. Creps."
''')
    b.chapter("Tilly's Diary")
    b.html('<div class="diary">')
    entries = [
        ('Wensday 4th Febuary',
         'Today was the wurst day of my hole life becos it rained and rained and Grandad Ezra sed the Brack wud come up and it DID. '
         'It came rite up to the gate. Kezia got her shoos wet anyway even with wellys becos she fell over. I laffed and she sed I was '
         'a little <del>stupid</del> horribel child. I am not horribel I am eight.'),
        ('Thursday 5th Febuary',
         'My freind Amira from home sent me a messige on Mums fone. She sed are you having fun in the countrey. I sed no but realy I '
         'am a bit. There is a dog called Sausidge who is not a sausidge he is a dog. Grandad sed that the dog is cleverer than the '
         'vicar but I am not alowed to say that to the vicar.'),
        ('Friday 6th Febuary',
         'Deshawn tort me to whistel with two fingers. It is very dificult and you get spit on your hand. Grandad sed whistling '
         'indoors brings the devil but Mum sed thats just a sayin. I whistled in the bathroom and nothing hapened exept the tap '
         'dripped. Probly that was the devil. I am going to definately do it agen tomorow to make sure.'),
        ('Saturday 7th Febuary',
         'We are going home tomorow. I dont want to. I asked Grandad if I could stay and be his helper and he sed Ess, maid, thee can '
         'stop as long as thee like, but thy mother \'ave other idees. Then he gave me a peppermint that was a bit fluffy from his '
         'pocket and I ate it anyway becos it was a speshul occashun.'),
    ]
    for date, text in entries:
        b.p(date, cls='date')
        b.p(text, cls='entry')
    b.p('THE END (for now)', cls='end')
    b.html('</div>')
    css = BOOK_CSS + """
    .diary p { text-indent: 0; text-align: left; }
    .diary { font-family: 'DejaVu Sans'; font-size: 10pt; line-height: 20pt;
      background: repeating-linear-gradient(to bottom, transparent 0, transparent 19pt, #9bb7d4 19pt, #9bb7d4 20pt); }
    .date { font-weight: bold; text-decoration: underline; margin-top: 20pt; }
    .end { margin-top: 20pt; letter-spacing: 0.1em; }
    del { color: #555; }
    """
    weasy(b.document(css), out('dialect-diary.pdf'))
    save_book(b, out('dialect-diary.pdf'),
              notes='Struck-through word "stupid" (<del>) is in the diary and kept in truth; a perfect EPUB keeps it struck through. '
                    'The diary is set on ruled-paper background lines (CSS gradient).',
              must_keep=['gwain', "wi'out", 'afore', 'allus', "'zackly", 'Gurt soft lummock', 'no cap', 'innit', 'peng',
                         'argify', 'Dang me', "Thee bain't", 'seed', 'Wensday 4th Febuary', 'wurst', 'hole life', 'becos',
                         'freind', 'sed', 'Probly', 'definately', 'tomorow', 'speshul occashun', 'horribel', 'Sausidge',
                         'Ess, maid', 'tort me to whistel', 'exept', 'idees', 'laffed', 'wellys'])


# 3 ---------------------------------------------------------------------------
GLOSSARY = [
    ('Glimber-tide', 'n.', 'the hour after sunset when the fen gives back the light it has borrowed all day.'),
    ('Wheem', 'v.', 'to move sideways in a hopeful manner, as a spratchet does towards a saucer.'),
    ('Spratchet', 'n.', 'a fen creature about the size of a teapot, never seen drinking.'),
    ('Plimsome', 'adj.', 'pleasantly out of tune.'),
    ('Moonwhistle', 'n.', 'a reed that sounds only when nobody is listening for it.'),
    ('Grobbly', 'adv.', 'with a full mouth and an easy conscience.'),
    ('Wuzzard-hen', 'n.', 'a bird that lays one square egg in a twelvemonth.'),
    ('Zantering-pole', 'n.', 'a long ash pole used for testing the depth of puddles and the patience of neighbours.'),
    ('Snorkle', 'v. & n.', 'to go about in damp weather making small remarks; also the weather itself.'),
    ('Flinderwasp', 'n.', 'a harmless glowing insect of the dimmerwood, said to be made of leftover lantern-light.'),
    ('Quiffling', 'adj.', 'arranged in rows that will not stay arranged.'),
    ('Flunge', 'n.', 'the long, sad, upward part of a Gindlebat.'),
    ('Scrittle', 'n.', 'the wide part, with the feathers.'),
    ('Quorble', 'v.', 'to hum on a staircase without meaning to.'),
    ('Plinketing', 'pres. part.', 'falling gently, as small notes or rain.'),
    ('Glimmet', 'n.', 'a thin cordial of elder and pepper, left out for spratchets and drunk by cats.'),
    ('Flummish', 'adj.', '(of weather or thought) grey, uncertain, faintly damp at the edges.'),
]
PLACES = ['Hoobledock', 'Brackensnood', 'Uthwick Parva', 'Uthwick Magna', 'Zell-Amaranth', 'Otterbrigg', 'Thrumbletree Cross',
          'Quillimore-on-Fenn', 'Snerchley', 'Grindlemoor', 'Ombertrail', 'Little Wheeming', 'Gloaming St. Bede', 'Vanderquay',
          'Plashet-under-Wold', 'Scrittlecombe', 'Muckle Flunge', 'Dimmerwood', 'Fenwhistle', 'Yawnsby', 'Crankle Bottom',
          'Nethergloam', 'Ballyquorble', 'Frith-on-the-Spratch', 'Zanterby', 'East Glimmet', 'West Glimmet', "Wuzzard's Knoll",
          'Pottle End', 'Sneap', 'Hagglethorpe', 'Bramblesquash', 'Ickenwold', 'Tiddlecombe Episcopi', 'Lower Snorkling',
          'Upper Snorkling', 'Marrowgate', 'Flinderby', 'Quiffle Green', 'Sallowmere', 'Oakenplash', 'Drumbelow',
          'Whimsey St. Agnes', 'Gorringe', 'Kettlewhistle', "Nubbin's Ford", 'Plimsome Parva', 'Yarrowquay']
PERSONS = ['Tamsk Oddery, fenman', 'Dame Orrible Thwaite, of Hagglethorpe', 'Sir Fennick Gloam, Bart.',
           'Mrs. Ysolde Brunch, keeper of the Glimmet House', 'Zebulon Quarrie, sexton', 'the Widow Plumtrice',
           'Hesketh Ambleworth-Vey, surveyor of puddles', 'Pellam Quask, almanack-maker', 'Old Mother Snibb',
           'the Rev. Ottoline Pargeter-Hume', 'Captain Bastable Whorl, late of the Vanderquay packet',
           'Miss Euphemia Thrupp, who keeps bees and opinions', 'Jory Gindle, wuzzard-catcher', 'Absalom Fitchet-Grue',
           'the twins Pim and Pellow Scrattle', 'Mrs. Zinnia Oakenshaw-Mott', 'Lemuel Pratchet, cooper',
           'Dorcas Vell, the Snerchley midwife', 'Ignatius Blee', 'Bartholomew Quorn-Tiddy, J.P.']


def invented_words():
    b = Book('invented-words', 'The Glimmerwick Almanack', 'Pellam Quask',
             'A nonsense poem and prose packed with invented words, a glossary, and long lists of made-up places and persons.')
    b.chapter('The Gindlebat of Hoobledock')
    b.verse('''When glimber-tide on Hoobledock
  Had wheemed the spratchets from the fen,
And plimsome rang the moonwhistles,
  And grobbly sang the wuzzard-hen,

Old Tamsk unhooked his zantering-pole
  And snorkled down to Brackensnood,
Where flinderwasps in quiffling rows
  Lit up the yawning dimmerwood.

"O Gindlebat, O Gindlebat,
  Thy flunge is long, thy scrittle wide!
I've come to ask thee, scrumbly thing,
  Where all the yesterdays have hied."

The Gindlebat unrolled its ears
  And blinked its seven glimmering eyes:
"They're folded up in Ombertrail,
  Behind the pantry of the skies."

So Tamsk went home by Thrumbletree,
  And quorbled softly on the stair,
And all night long the moonwhistles
  Went plinketing about the air.''')
    b.chapter('For the Month of Snerch')
    b.ps('''
In the month of Snerch the spratchets come down from the high fells to wheem in the shallows, and a careful fenman may hear them at glimber-tide, a sound like a kettle trying to remember a tune. It is the custom in Hoobledock to leave out a saucer of glimmet for them, though no one has ever seen a spratchet drink, and the glimmet is generally found next morning to have been drunk by the Vicar's cat.

The wuzzard-hen lays but one egg in a twelvemonth, and that egg is square. Old women in Uthwick Parva say that a square egg, if kept in a drawer of clean linen until Plumbsday, will hatch into either a very small wuzzard or a very large opinion, and that there is no way to tell which until it begins to speak. Mrs. Brunch of the Glimmet House kept one for eleven years; it never hatched, but it grew noticeably more confident.

Persons travelling to Zell-Amaranth in Snerch are advised to carry a spare quorbling-cloth, a pair of dry socks, and no strong views about the weather, which in the low parishes will be flummish to snorkly, with outbreaks of plinket after noon and a gindling wind off Muckle Flunge towards evening.

Sowing: Moonwhistle seed may be set out on the first fair Thrumpday after the new moon, three fingers deep and a polite distance apart. Do not sow on a Grumbleday. Do not sow at all if a flinderwasp has looked at you.
''')
    b.chapter('A Glossary of Fen Words')
    for term, pos, d in GLOSSARY:
        b.p(f'<b>{term}</b>, <i>{pos}</i> {d}', cls='gl')
    b.chapter('A Gazetteer of the Fen Parishes')
    b.lst(PLACES, cls='cols3')
    b.chapter('Persons of Note in the Fen Parishes')
    b.lst(PERSONS, cls='cols2')
    css = BOOK_CSS + """
    .gl { text-indent: -1.5em; padding-left: 1.5em; margin-bottom: 0.35em; text-align: left; }
    ul { list-style: none; padding: 0; margin: 0; }
    .cols3 { columns: 3; column-gap: 6mm; font-size: 9.5pt; }
    .cols2 { columns: 2; column-gap: 6mm; font-size: 9.5pt; }
    li { margin-bottom: 0.2em; break-inside: avoid; }
    """
    weasy(b.document(css), out('invented-words.pdf'))
    must = ['glimber-tide', 'Hoobledock', 'wheemed the spratchets', 'plimsome', 'moonwhistles', 'grobbly', 'wuzzard-hen',
            'zantering-pole', 'snorkled', 'Brackensnood', 'flinderwasps', 'quiffling', 'dimmerwood', 'Gindlebat', 'flunge',
            'scrittle', 'scrumbly', 'Ombertrail', 'Thrumbletree', 'quorbled', 'plinketing', 'glimmet', 'Plumbsday', 'Thrumpday',
            'Grumbleday', 'snorkly', 'gindling', 'quorbling-cloth', 'Tiddlecombe Episcopi', 'Frith-on-the-Spratch',
            'Pargeter-Hume', 'Quorn-Tiddy', 'Fitchet-Grue', 'Oakenshaw-Mott'] + PLACES
    save_book(b, out('invented-words.pdf'),
              notes='Place list is set in three columns, persons in two: truth keeps one entry per line in column order '
                    '(top to bottom, then next column).', must_keep=must)


# 4 ---------------------------------------------------------------------------
def poetry():
    b = Book('poetry', 'Salt and Lamplight', 'Annis Keverne',
             'Poems: indented stanzas, a staggered stair-shaped poem, a falling-leaf shape, hyphenated verse line ends, a long '
             'turnover line, a prose poem and lowercase "i".')
    b.chapter('Harbour Hymn')
    b.verse('''Lift up the lamp, the tide is turning,
  the boats come home by twos and threes;
the gulls are white as linen burning
  on the grey wire of the seas.

Lift up the lamp for those not landing,
  for nets that came back light as air;
for Annie Croft, who keeps on standing
  where the harbour ends in prayer.

Lift up the lamp. The wind has spoken.
  It said the same thing as before.
The pier is old, the rail is broken,
  and someone's knocking at the door.''')
    b.chapter('Stairwell')
    stair = ['I', 'went', 'down', 'the', 'stairs', 'to', 'find', 'the', 'cellar', 'had', 'no', 'floor',
             'and', 'I', 'came', 'back', 'up', 'with', 'nothing', 'in', 'my hands']
    steps = list(range(12)) + list(range(10, -1, -1))[:len(stair) - 12]
    b.verse('\n'.join('  ' * 2 * s + w for s, w in zip(steps, stair)), cls='verse stair')
    b.chapter('September Ferry')
    b.verse('''The ferry-
man counts us twice and gets two answers.
Sep-
tember lies across the water like a coat
somebody meant to come back for.

We sit on the slatted bench, the six of us, and nobody says the thing that everyone is thinking, which is that the far shore has not got any closer since we left the near one,
and the gulls go on unstitching
the hem of the after-
noon.''')
    b.chapter('What the Kettle Knew')
    b.p('That the house was colder than it let on. That the woman who filled it every morning at ten past six had stopped '
        'singing in March and started again, quietly, in the second week of June, a song with no words and only four notes, '
        'the last of which she never quite reached. That steam is a kind of forgetting. That the man who used to take it off '
        'the ring too early, before it had properly said what it meant to say, was not coming back, and that this was why the '
        'second cup stayed on the hook. That it was allowed, now, to finish its sentences. That it did not always want to.',
        cls='prose-poem')
    b.chapter('Leaf')
    leaf = ['a', 'leaf', 'let go', 'of the oak', 'and took all', 'afternoon about', 'the business of', 'coming down,',
            'turning its', 'palms up,', 'then', 'down,', 'as if', 'asked', 'to choose', 'and', 'not', 'choosing']
    offs = [6, 5, 4, 3, 2, 1, 1, 2, 3, 5, 7, 8, 9, 10, 11, 13, 14, 15]
    b.verse('\n'.join('  ' * o + w for o, w in zip(offs, leaf)), cls='verse leaf')
    b.chapter('small hours')
    b.verse('''i think of you & the kettle
& the kettle thinks of nothing
     which is its gift

i count the stairs   eleven
then again   eleven
the house agrees with me tonight''')
    css = BOOK_CSS + """
    h1 { font-style: italic; font-size: 15pt; text-align: left; margin-left: 2em; }
    .verse { margin-left: 2em; }
    .stair .l, .leaf .l { padding-left: 0; text-indent: 0; }
    .stair .stanza, .leaf .stanza { line-height: 1.25; }
    .prose-poem { text-indent: 0; margin: 0 2em; }
    .verse .l { white-space: pre-wrap; }
    """
    weasy(b.document(css), out('poetry.pdf'))
    save_book(b, out('poetry.pdf'),
              notes='Verse line breaks must be kept. "The ferry-/man", "Sep-/tember" and "after-/noon" are deliberate verse '
                    'line ends: keep the hyphen and the break (do not join). The long line in "September Ferry" wraps in the '
                    'PDF with a hanging indent; it is ONE verse line in truth. "Stairwell" and "Leaf" are shaped by indentation '
                    '(shape lives in the indent; truth keeps one word-group per line). "What the Kettle Knew" is a prose poem '
                    '(one paragraph, not verse). "small hours" uses lowercase i, & and internal spaces (truth keeps the runs of spaces).',
              must_keep=['The ferry-\nman', 'Sep-\ntember', 'the hem of the after-\nnoon.', 'i think of you & the kettle',
                         'i count the stairs   eleven', "and someone's knocking at the door.",
                         'which is that the far shore has not got any closer since we left the near one,'])


# 5 ---------------------------------------------------------------------------
LONG = [
    """It was generally agreed in the parish of Upper Hensleigh, by those who had known the late Mr. Absalom Fenwright (and there were fewer of these than the size of his funeral might have suggested, since a good many of the mourners had come, as mourners in small parishes will, less from affection than from a reasonable curiosity about the will), that he had been a difficult man, a careful man, a man who counted the sugar lumps in the bowl before his housekeeper went to bed and counted them again in the morning, and who once, in the hard winter of the year the river froze as far as Gedge's Mill, walked eleven miles through the snow to the market at Callowfield in order to return a ha'penny that a stall-keeper had given him by mistake — not, as he was careful to explain to anyone who would listen, out of honesty, which he regarded as a habit of the comfortable classes, but out of a settled conviction that a debt left standing was a door left open, and that through an open door, sooner or later, there would come in the cold, the cat, and the Collector of Rates; and it was therefore with something more than ordinary surprise that the parish learned, on the Tuesday after the funeral, that he had left the whole of his considerable fortune — the house at Hensleigh Cross, the three farms beyond the water-meadows, the shares in the Callowfield and District Gas Company, the gold watch, the walnut bureau, and a sum in the Funds that Mrs. Pratchley at the post office put, on no evidence at all, at forty thousand pounds — not to his nephew, Mr. Lionel Fenwright of Bayswater, who had confidently expected it, nor to the Church, which had hopefully expected it, nor to the Cottage Hospital, which had not expected it but would have known exactly what to do with it, but to a person whom nobody in Upper Hensleigh had ever heard of, a Miss Perpetua Quennell-Marsh, of no fixed address.""",
    """Within a fortnight there had arrived at the Hensleigh Arms, in a succession that the landlord, Mr. Oswin Gedge, afterwards compared to the plagues of Egypt (though he was careful to add that the plagues had at least paid in advance), no fewer than eleven persons each claiming to be, or to represent, or to have been engaged to, or to have been wronged by, the elusive Miss Quennell-Marsh: there was a Mrs. Tabitha Vane-Ormerod, who said she was the young lady's aunt; a Mr. Corwin Pask, who said he was her solicitor, and produced a card to prove it, though the card had been printed for a Mr. Corwin Pash; a retired sea-captain named Elphinstone Drewe, who said nothing at all for three days and then asked for the mustard; two sisters, Hepzibah and Clementine Lusk, who claimed to have nursed her through the measles at a school in Eastbourne which, upon enquiry, turned out to have been a boarding-house for commercial gentlemen; a young man in a yellow waistcoat calling himself the Honourable Ambrose Kittering-Fane, whose honourableness did not survive the arrival of a policeman from Callowfield; a Belgian gentleman, M. Achille Vandersloot, who wished to sell everybody a patent bicycle lamp and only incidentally mentioned that he had once danced with Miss Quennell-Marsh at Ostend; a Mrs. Rook and a Mr. Rooke, who were not related and became very angry when it was suggested that they were; a very old woman named Dorcas Pennyfeather, who sat by the fire and knitted and could not be induced to say whom she had come to see; and lastly, on the eleventh day, arriving by the late train with one small bag, a quiet, sandy-haired woman of about thirty who signed the register in a clear hand as P. Marsh, ordered a pot of tea and a boiled egg, and went to bed at nine.""",
    """The house at Hensleigh Cross, when the lawyers at last unlocked it, proved to be very much what the parish had always supposed — dark, high-ceilinged, smelling of camphor and boiled cabbage and the particular cold of rooms in which nobody has sat down for a long time — except in one respect, which was that every drawer, every cupboard, every shelf and every box in it (and there were, according to the inventory drawn up by Mr. Pask, who had by this time been admitted to be a solicitor after all, though of a firm in Leominster that did mostly conveyancing, four hundred and twelve drawers, ninety-one cupboards, and boxes beyond counting) was filled with the same thing, namely, sugar lumps, each wrapped in a twist of paper, each twist of paper bearing a date in Mr. Fenwright's small, crabbed, unmistakable hand, the earliest of them being the fourth of March, eighteen hundred and sixty-one, and the latest being the morning of the day on which he died; so that it seemed, to those who stood in the dim front parlour among the drifts of little paper twists and tried to understand what they were looking at, that the old man had kept, every day for more than forty years, one lump of sugar back from the bowl — one lump that he might have had in his tea and did not — and had wrapped it, and dated it, and put it away, for what purpose, or for whom, nobody could say; although Miss Marsh, when she was shown the parlour, stood for a long time without speaking, and then sat down on the horsehair sofa and laughed until she cried, and would not explain herself to anybody, not even to the Vicar.""",
    """What became of the fortune is soon told, and the parish has told it many times since, in the Hensleigh Arms and the post office and the vestry, with additions and improvements according to the teller (Mrs. Pratchley, for instance, maintains to this day that the sum in the Funds was nearer sixty thousand, and that Captain Drewe was a Russian), but the bare facts are these: that Miss Marsh, having been satisfied of her identity by Mr. Pask, by a letter in Mr. Fenwright's hand, and by a small daguerreotype found in the walnut bureau of a young woman with her chin and her eyebrows, took possession of the house at Hensleigh Cross on Lady Day; that she gave the three farms to the men who worked them, the gold watch to Mr. Gedge, the shares in the Gas Company to the Cottage Hospital, and the walnut bureau to Mrs. Pratchley, who had always admired it; that she sent Mr. Lionel Fenwright of Bayswater a parcel containing one sugar lump, wrapped in a twist of paper and dated in his uncle's hand on the day of his own christening, together with a note of four words that the Bayswater postman, who read it, afterwards reported as being 'He kept this back'; and that she lived in the house for the remaining fifty-one years of her life, a cheerful, sandy, sensible woman who took three lumps of sugar in her tea and never once, so far as anybody could discover, counted them.""",
]


def long_sentences():
    b = Book('long-sentences', 'The Fenwright Inheritance', 'Hester Callow',
             'Victorian-style prose built from 250-350-word sentences stuffed with semicolons, parentheses, dashes and invented names.')
    short = [
        'Nobody, of course, had heard of her because nobody had been told.',
        'Mr. Gedge put the eleven of them in the four rooms he had, and charged accordingly.',
        'It was the sugar, in the end, that settled the matter, although not in the way that anybody had expected.',
        'The parish has never quite forgiven her for it.',
    ]
    titles = ['I. The Will', 'II. The Claimants', 'III. The House', 'IV. The Fortune']
    counts = []
    for t, s, extra in zip(titles, LONG, short):
        b.chapter(t)
        b.p(' '.join(s.split()))
        counts.append(len(s.split()))
        b.p(extra)
    assert all(200 <= c <= 400 for c in counts), counts
    css = BOOK_CSS + """
    @page :left { @top-left { content: 'The Fenwright Inheritance'; font: italic 8.5pt 'Noto Serif'; } }
    @page :right { @top-right { content: string(chap); font: italic 8.5pt 'Noto Serif'; } }
    h1 { string-set: chap content(); break-before: auto; margin-top: 1.5em; }
    p { hyphens: auto; }
    """
    weasy(b.document(css), out('long-sentences.pdf'))
    save_book(b, out('long-sentences.pdf'),
              notes=f'Each chapter opens with one sentence of {counts} words respectively; the converter must not split, '
                    'shorten or re-punctuate them. Text is hyphenated (hyphens: auto); soft line-end hyphens must be removed.',
              must_keep=['Quennell-Marsh', 'Mr. Corwin Pash', 'Kittering-Fane', 'M. Achille Vandersloot',
                         'a Mrs. Rook and a Mr. Rooke', 'Dorcas Pennyfeather', "ha'penny", 'Leominster', 'Hepzibah and Clementine Lusk',
                         'Vane-Ormerod', 'Elphinstone Drewe', "'He kept this back'"] + [' '.join(s.split()[:12]) for s in LONG],
              long_sentence_words=counts)


# 6 ---------------------------------------------------------------------------
BILINGUAL = [
    ("On the island of Kerrec there is a lighthouse, and in the lighthouse there was, for many years, a keeper named Yann Morvan, and with the keeper there lived a cat who had no name at all. Yann said that a cat who lives at the end of the world has no need of a name, since there is nobody to call it, and the cat, for its part, seemed to agree.",
     "Sur l'île de Kerrec il y a un phare, et dans ce phare vécut, pendant de longues années, un gardien nommé Yann Morvan, et avec le gardien vivait un chat qui n'avait pas de nom du tout. Yann disait qu'un chat qui vit au bout du monde n'a pas besoin de nom, puisqu'il n'y a personne pour l'appeler, et le chat, de son côté, semblait être de cet avis."),
    ("Every evening, a little before sunset, Yann climbed the hundred and twelve steps of the tower to light the lamp, and every evening the cat climbed them behind him, one step at a time, stopping now and then to look back down the spiral as if it had forgotten something. At the top it sat on the iron rail of the gallery and watched the sea grow dark, and when the great lamp began to turn, it closed its eyes against the light and purred so loudly that Yann claimed he could hear it above the wind.",
     "Chaque soir, un peu avant le coucher du soleil, Yann montait les cent douze marches de la tour pour allumer la lampe, et chaque soir le chat les montait derrière lui, une marche après l'autre, s'arrêtant de temps en temps pour regarder en bas de l'escalier en colimaçon, comme s'il avait oublié quelque chose. En haut, il s'asseyait sur la rambarde de fer de la galerie et regardait la mer s'assombrir, et quand la grande lampe se mettait à tourner, il fermait les yeux contre la lumière et ronronnait si fort que Yann prétendait l'entendre par-dessus le vent."),
    ("In the winter of the great storm, the supply boat could not come for six weeks. The flour ran low, then the coffee, then the paraffin for the little stove in the kitchen, though never — Yann was very careful about this — the oil for the lamp. He ate potatoes and salt fish and, towards the end, a great deal of porridge made with water. The cat ate whatever it caught among the rocks and whatever Yann gave it from his plate, which was more than he could spare, and on the worst nights, when the whole tower shook and the spray came over the gallery like gravel thrown against a window, it slept on his chest and would not be moved. He said afterwards that he did not know which of them had been keeping the other alive, and that he had stopped asking somewhere around the fourth week, because the question did not seem to matter as much as it had at the beginning.",
     "Pendant l'hiver de la grande tempête, le bateau de ravitaillement ne put venir pendant six semaines. La farine vint à manquer, puis le café, puis le pétrole du petit poêle de la cuisine, mais jamais — Yann y veillait de très près — l'huile de la lampe. Il mangea des pommes de terre et du poisson salé et, vers la fin, beaucoup de bouillie d'avoine faite à l'eau. Le chat mangeait ce qu'il attrapait parmi les rochers et ce que Yann lui donnait de son assiette, c'est-à-dire plus qu'il ne pouvait se le permettre, et les pires nuits, quand toute la tour tremblait et que les embruns passaient par-dessus la galerie comme du gravier jeté contre une vitre, il dormait sur sa poitrine et refusait de bouger. Yann dit plus tard qu'il ne savait pas lequel des deux avait gardé l'autre en vie, et qu'il avait cessé de se le demander vers la quatrième semaine, parce que la question ne lui paraissait plus aussi importante qu'au début."),
    ("When the boat came at last, the boatman, a big red-faced man from Lannilis named Gwenaël, climbed up onto the jetty and looked at Yann, and looked at the cat, and said: ‘Well, you are both thinner than you were, but you are both still here, which is more than I can say for the jetty at Porz Gwenn.’ Then he unloaded the flour and the coffee and the paraffin, and a newspaper six weeks old, and a letter.",
     "Quand le bateau arriva enfin, le batelier, un grand gaillard rougeaud de Lannilis qui s'appelait Gwenaël, grimpa sur la jetée, regarda Yann, regarda le chat, et dit : « Eh bien, vous avez maigri tous les deux, mais vous êtes encore là tous les deux, ce qui est plus que je n'en peux dire de la jetée de Porz Gwenn. » Puis il déchargea la farine, le café et le pétrole, un journal vieux de six semaines, et une lettre."),
    ("The letter was from the Administration of Lighthouses and Beacons, and it said, in many words, that the lighthouse of Kerrec was to be made automatic in the spring, and that the keeper's services would no longer be required, and that the Administration thanked him for his long and faithful service. It did not mention the cat. Yann read the letter twice, standing on the jetty in the wind, and then folded it very small and put it in the pocket of his coat, and went up to light the lamp, although it was not yet four o'clock.",
     "La lettre venait de l'Administration des Phares et Balises, et elle disait, en beaucoup de mots, que le phare de Kerrec serait automatisé au printemps, que l'on n'aurait plus besoin des services du gardien, et que l'Administration le remerciait de ses longs et loyaux services. Elle ne parlait pas du chat. Yann lut la lettre deux fois, debout sur la jetée dans le vent, puis il la plia tout petit, la mit dans la poche de son manteau et monta allumer la lampe, bien qu'il ne fût pas encore quatre heures."),
    ("In the spring the engineers came with their crates of cables and their humming grey boxes, and in a week it was done. The lamp turned by itself now, and lit itself, and put itself out at dawn, and needed nobody. Yann packed his two suitcases. The cat watched him do it from the top of the wardrobe, with an expression that Yann said he would not forget as long as he lived.",
     "Au printemps, les ingénieurs arrivèrent avec leurs caisses de câbles et leurs boîtes grises qui bourdonnaient, et en une semaine tout fut fait. La lampe tournait toute seule désormais, s'allumait toute seule, s'éteignait toute seule à l'aube, et n'avait plus besoin de personne. Yann fit ses deux valises. Le chat le regarda faire du haut de l'armoire, avec une expression que Yann disait qu'il n'oublierait jamais de sa vie."),
    ("They say on the mainland that the cat would not leave. They say that Yann carried it down to the boat three times, and three times it slipped out of his arms and ran back up the jetty and sat at the foot of the tower, looking at him; and that the third time Gwenaël said, gently, for a big man, ‘Leave it, Yann. Somebody has to stay.’ And they say — though this part I do not believe — that on clear nights, if you are out on the water off Kerrec when the lamp begins to turn, you can still hear it purring above the wind.",
     "On raconte sur le continent que le chat ne voulut pas partir. On raconte que Yann le porta trois fois jusqu'au bateau, et que trois fois il lui glissa des bras, remonta la jetée en courant et s'assit au pied de la tour en le regardant ; et que la troisième fois Gwenaël dit, doucement pour un homme si grand : « Laisse-le, Yann. Il faut bien que quelqu'un reste. » Et on raconte — mais cela, je n'y crois pas — que par les nuits claires, si l'on se trouve en mer au large de Kerrec quand la lampe se met à tourner, on l'entend encore ronronner par-dessus le vent."),
]


def bilingual():
    b = Book('bilingual', "The Keeper's Cat / Le Chat du gardien", 'Loïc Penhoat',
             'Parallel text: English left, French right, paragraph by paragraph, rows breaking across pages.')
    b.chapter("The Keeper's Cat", record=True, tag='h1', cls='hidden')
    b.chapter('Le Chat du gardien', record=True, tag='h1', cls='hidden')
    b.body.clear()
    rows = ['<tr class="head"><td><h1 lang="en">The Keeper\'s Cat</h1></td><td><h1 lang="fr">Le Chat du gardien</h1></td></tr>']
    for en, fr in BILINGUAL:
        rows.append(f'<tr><td lang="en"><p>{esc(en)}</p></td><td lang="fr"><p>{esc(fr)}</p></td></tr>')
        b.t(en)
        b.t(fr)
    b.html('<table class="par">' + ''.join(rows) + '</table>')
    css = BOOK_CSS + """
    @page { size: 176mm 250mm; margin: 20mm 14mm 22mm 14mm;
      @top-left { content: 'English'; font: italic 8.5pt 'Noto Serif'; }
      @top-right { content: 'Français'; font: italic 8.5pt 'Noto Serif'; } }
    html { font-size: 11pt; hyphens: auto; }
    table.par { width: 100%; border-collapse: separate; border-spacing: 0; margin: 0; font-size: 11pt; table-layout: fixed; }
    table.par td { width: 50%; border: none; padding: 0 5mm 0.8em 0; text-align: justify; }
    table.par td + td { padding: 0 0 0.8em 5mm; border-left: 0.5pt solid #999; }
    table.par tr { break-inside: auto; }
    table.par h1 { break-before: auto; font-size: 15pt; margin: 0 0 1em; }
    table.par p { text-indent: 1.2em; }
    """
    weasy(b.document(css), out('bilingual.pdf'))
    save_book(b, out('bilingual.pdf'),
              notes='Two-column parallel text built as a table; long rows break across pages so paragraphs continue on '
                    'the next page in both columns. Truth interleaves EN/FR per paragraph pair (row reading order); keeping all '
                    'English then all French is also acceptable. French uses no-break spaces before : ; and inside « ». '
                    'Running heads "English"/"Français" are furniture.',
              must_keep=['Gwenaël', 'Porz Gwenn', 'Il faut bien que quelqu\'un reste.', 'bien qu\'il ne fût pas encore quatre heures',
                         'Somebody has to stay.', 'Phares et Balises', 'lequel des deux'])


CASES = [archaic, dialect_diary, invented_words, poetry, long_sentences, bilingual]
