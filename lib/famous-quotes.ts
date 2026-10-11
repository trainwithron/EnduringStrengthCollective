// Short quotes by well-known people for the post-workout share card's "absurd" kind (lib/workout-fun-line.ts). The card shows `${text} - ${by}`.
//
// Rules every quote here follows (Spot / Ron: no approval round, so the rules are the review):
//   - the attribution is documented, and the source is written next to the quote. Anything commonly misattributed, or that could not be sourced, is NOT here
//     (left out on purpose: "It does not matter how slowly you go..." (Confucius), "Whether you think you can..." (Ford), "Success is not final..." (Churchill),
//     "You have power over your mind..." (Marcus Aurelius), "Luck is what happens when preparation meets opportunity" (Seneca), "Excellence is never an accident"
//     (Aristotle), "Whatever you can do, or dream you can..." (Goethe), "Whatever you are, be a good one" (Lincoln), and similar);
//   - no song lyrics, nothing in the first person (no I / my / me), nothing about bodies, weight, age, food or falling short, no politics of the day, no faith lines;
//   - at most 110 characters with the attribution (the card's two-line clamp), a test holds this;
//   - old works are quoted in the public-domain translation named in the source note; a trimmed quote says "excerpt" so no one mistakes it for the whole sentence.
// The share-card tests apply the same voice and topic bans to these lines as to the rest of the bank; Ron's own lines are the only exemption (RON_LINES).

export interface FamousQuote {
  text: string;
  by: string;
  // Where it was said or published (work, chapter or date; translation for old works).
  source: string;
}

const q = (text: string, by: string, source: string): FamousQuote => ({ text, by, source });

export const FAMOUS_QUOTES: FamousQuote[] = [
  // ---- Philosophers ----
  q("Men become builders by building and lyre-players by playing the lyre.", "Aristotle", "Nicomachean Ethics II.1, 1103a-b (Ross translation, 1908)"),
  q("One swallow does not make a summer, nor does one day.", "Aristotle", "Nicomachean Ethics I.7, 1098a (Ross translation, 1908)"),
  q("Moral virtue comes about as a result of habit.", "Aristotle", "Nicomachean Ethics II.1, 1103a (Ross translation, 1908)"),
  q("It matters not how long the action is spun out, but how good the acting is.", "Seneca", "Moral Letters 77.20 (Gummere translation, 1917; excerpt of 'It is with life as it is with a play')"),
  q("We suffer more often in imagination than in reality.", "Seneca", "Moral Letters 13.4 (Gummere translation, 1917)"),
  q("While we are postponing, life speeds by.", "Seneca", "Moral Letters 1.2 (Gummere translation, 1917; numbered 1.3 in some Latin editions)"),
  q("Nothing is ours, except time.", "Seneca", "Moral Letters 1.3 (Gummere translation, 1917; the address to Lucilius is left out)"),
  q("Associate with those who will make a better man of you.", "Seneca", "Moral Letters 7.8 (Gummere translation, 1917)"),
  q("Philosophy teaches us to act, not to speak.", "Seneca", "Moral Letters 20.2 (Gummere translation, 1917)"),
  q("Aye, the willing soul Fate leads, but the unwilling drags along.", "Seneca", "Moral Letters 107.11 (Gummere translation, 1917; Seneca quoting Cleanthes)"),
  q("Fire tests gold, adversity tests brave men.", "Seneca", "On Providence 5.9; Latin 'ignis aurum probat, miseria fortes viros' (plain rendering; Stewart 1900: 'Fire tries gold, misfortune tries brave men')"),
  q("First say to yourself what you would be; and then do what you have to do.", "Epictetus", "Discourses 3.23 (Carter translation, revised by Higginson, 1865)"),
  q("Make the best of what is in our power, and take the rest as it occurs.", "Epictetus", "Discourses 1.1 (Carter translation, revised by Higginson, 1865)"),
  q("Difficulties are things that show what men are.", "Epictetus", "Discourses 1.24 (Carter translation, revised by Higginson, 1865)"),
  q("No great thing is created suddenly, any more than a bunch of grapes or a fig.", "Epictetus", "Discourses 1.15 (Carter translation, revised by Higginson, 1865)"),
  q("If it is not right, do not do it; if it is not true, do not say it.", "Marcus Aurelius", "Meditations 12.17 (Long translation, 1862)"),
  q("Do not act as if thou wert going to live ten thousand years.", "Marcus Aurelius", "Meditations 4.17 (Long translation, 1862)"),
  q("Look within. Within is the fountain of good.", "Marcus Aurelius", "Meditations 7.59 (Long translation, 1862; excerpt)"),
  q("Confine thyself to the present.", "Marcus Aurelius", "Meditations 7.29 (Long translation, 1862)"),
  q("Be like the promontory against which the waves continually break; but it stands firm.", "Marcus Aurelius", "Meditations 4.49 (Long translation, 1862; excerpt)"),
  q("The soul is dyed by the thoughts.", "Marcus Aurelius", "Meditations 5.16 (Long translation, 1862; excerpt)"),
  q("To see what is right and not to do it is want of courage.", "Confucius", "Analects 2.24 (Legge translation, 1861)"),
  q("Learning without thought is labor lost; thought without learning is perilous.", "Confucius", "Analects 2.15 (Legge translation, 1861)"),
  q("Is it not pleasant to learn with a constant perseverance and application?", "Confucius", "Analects 1.1 (Legge translation, 1861)"),
  q("The firm, the enduring, the simple, and the modest are near to virtue.", "Confucius", "Analects 13.27 (Legge translation, 1861)"),
  q("Virtue is not left to stand alone. He who practises it will have neighbours.", "Confucius", "Analects 4.25 (Legge translation, 1861)"),
  q("A journey of a thousand miles begins with a single step.", "Lao Tzu", "Tao Te Ching 64 (the usual English rendering of Legge's 'The journey of a thousand li commenced with a single step')"),
  q("He who overcomes others is strong; he who overcomes himself is mighty.", "Lao Tzu", "Tao Te Ching 33 (Legge translation, 1891)"),
  q("The tree which fills the arms grew from the tiniest sprout.", "Lao Tzu", "Tao Te Ching 64 (Legge translation, 1891)"),
  q("The beginning is the most important part of any work.", "Plato", "Republic 377a-b (Jowett translation)"),
  q("Life is short, and Art long.", "Hippocrates", "Aphorisms I.1 (Adams translation, 1849)"),
  q("Fortune favors the bold.", "Virgil", "Aeneid 10.284, 'audentis Fortuna iuvat' (plain rendering)"),
  q("They can conquer who believe they can.", "Virgil", "Aeneid 5.231, in Dryden's translation (1697)"),
  q("Dare to be wise.", "Horace", "Epistles 1.2.40, 'sapere aude' (plain rendering)"),

  // ---- Presidents, statesmen, public figures ----
  q("Always bear in mind that your own resolution to succeed is more important than any other one thing.", "Lincoln", "Letter to Isham Reavis, 5 November 1855"),
  q("It is wonderful how much may be done if we are always doing.", "Thomas Jefferson", "Letter to Martha Jefferson, Marseilles, 5 May 1787 (Papers of Thomas Jefferson 11:348-9)"),
  q("Nothing is troublesome that we do willingly.", "Thomas Jefferson", "Decalogue of Canons, letter to Thomas Jefferson Smith, 21 February 1825"),
  q("How much pain have cost us the evils which have never happened.", "Thomas Jefferson", "Decalogue of Canons, letter to Thomas Jefferson Smith, 21 February 1825"),
  q("Never put off till tomorrow what you can do today.", "Thomas Jefferson", "Decalogue of Canons, letter to Thomas Jefferson Smith, 21 February 1825"),
  q("Happiness lies ... in the joy of achievement, in the thrill of creative effort.", "Franklin D. Roosevelt", "First Inaugural Address, 4 March 1933 (excerpt)"),
  q("Speak softly and carry a big stick; you will go far.", "Theodore Roosevelt", "Minnesota State Fair, 2 September 1901 (quoted there as a homely adage)"),
  q("Plans are worthless, but planning is everything.", "Dwight D. Eisenhower", "National Defense Executive Reserve Conference, 14 November 1957"),
  q("Physical fitness is the basis of all the activities of our society.", "John F. Kennedy", "The Soft American, Sports Illustrated, 26 December 1960 (excerpt of 'In this sense, physical fitness is the basis of all the activities of our society')"),
  q("You must do the thing you think you cannot do.", "Eleanor Roosevelt", "You Learn by Living, 1960"),
  q("If there is no struggle, there is no progress.", "Frederick Douglass", "West India Emancipation speech, 3 August 1857"),
  q("Although the world is full of suffering, it is full also of the overcoming of it.", "Helen Keller", "Optimism, 1903"),
  q("Life is either a daring adventure, or nothing.", "Helen Keller", "Let Us Have Faith, 1940, 'Faith Fears Not'"),

  // ---- Writers and plays ----
  q("Sweet are the uses of adversity.", "Shakespeare", "As You Like It 2.1"),
  q("Nothing will come of nothing.", "Shakespeare", "King Lear 1.1"),
  q("Brevity is the soul of wit.", "Shakespeare", "Hamlet 2.2"),
  q("Our doubts are traitors, and make us lose the good we oft might win, by fearing to attempt.", "Shakespeare", "Measure for Measure 1.4"),
  q("How far that little candle throws his beams! So shines a good deed in a naughty world.", "Shakespeare", "The Merchant of Venice 5.1"),
  q("To thine own self be true.", "Shakespeare", "Hamlet 1.3"),
  q("Things won are done; joy's soul lies in the doing.", "Shakespeare", "Troilus and Cressida 1.2"),
  q("Come what come may, time and the hour runs through the roughest day.", "Shakespeare", "Macbeth 1.3"),
  q("Pleasure and action make the hours seem short.", "Shakespeare", "Othello 2.3"),
  q("The better part of valour is discretion.", "Shakespeare", "Henry IV, Part 1, 5.4"),
  q("Be not afraid of greatness.", "Shakespeare", "Twelfth Night 2.5 (excerpt)"),
  q("Courage is resistance to fear, mastery of fear - not absence of fear.", "Mark Twain", "Pudd'nhead Wilson, 1894, ch. 12 (Pudd'nhead Wilson's Calendar)"),
  q("Always do right. This will gratify some people and astonish the rest.", "Mark Twain", "Note to the Young People's Society, Greenpoint, 16 February 1901"),
  q("Well done is better than well said.", "Benjamin Franklin", "Poor Richard's Almanack, 1737"),
  q("Little strokes fell great oaks.", "Benjamin Franklin", "Poor Richard's Almanack, 1750"),
  q("Diligence is the mother of good luck.", "Benjamin Franklin", "Poor Richard's Almanack, 1736"),
  q("He that can have patience can have what he will.", "Benjamin Franklin", "Poor Richard's Almanack, 1736"),
  q("Do not squander time, for that's the stuff life is made of.", "Benjamin Franklin", "Poor Richard's Almanack, 1746"),
  q("The reward of a thing well done is to have done it.", "Emerson", "New England Reformers, Essays: Second Series, 1844"),
  q("Hitch your wagon to a star.", "Emerson", "Civilization, Society and Solitude, 1870"),
  q("All life is an experiment. The more experiments you make the better.", "Emerson", "Journal, November 1842"),
  q("A man is rich in proportion to the number of things which he can afford to let alone.", "Thoreau", "Walden, 1854, 'Where I Lived, and What I Lived For'"),
  q("Heaven is under our feet as well as over our heads.", "Thoreau", "Walden, 1854, The Pond in Winter"),
  q("The question is not what you look at, but what you see.", "Thoreau", "Journal, 5 August 1851"),
  q("If a thing is worth doing, it is worth doing badly.", "G.K. Chesterton", "What's Wrong with the World, 1910, Part Four, ch. XIV 'Folly and Female Education'"),
  q("An adventure is only an inconvenience rightly considered.", "G.K. Chesterton", "On Running After One's Hat, All Things Considered, 1908"),
  q("Begin at the beginning, and go on till you come to the end: then stop.", "Lewis Carroll", "Alice's Adventures in Wonderland, 1865, ch. 12"),
  q("There is nothing--absolute nothing--half so much worth doing as simply messing about in boats.", "Grahame", "The Wind in the Willows, 1908, ch. 1"),
  q("If you can fill the unforgiving minute with sixty seconds' worth of distance run", "Rudyard Kipling", "If-, 1910 (excerpt)"),
  q("To strive, to seek, to find, and not to yield.", "Tennyson", "Ulysses, 1842"),
  q("Learn to labor and to wait.", "Longfellow", "A Psalm of Life, 1838"),
  q("The heights by great men reached and kept were not attained by sudden flight.", "Longfellow", "The Ladder of St. Augustine, 1850"),
  q("The best way out is always through.", "Robert Frost", "A Servant to Servants, North of Boston, 1914"),
  q("Energy is eternal delight.", "William Blake", "The Marriage of Heaven and Hell, c. 1790"),
  q("If the fool would persist in his folly he would become wise.", "William Blake", "Proverbs of Hell, The Marriage of Heaven and Hell, c. 1790"),
  q("Ah, but a man's reach should exceed his grasp.", "Robert Browning", "Andrea del Sarto, 1855"),
  q("Genius is one percent inspiration and ninety-nine percent perspiration.", "Thomas Edison", "Attributed to Edison from 1901 (Idaho Statesman, 6 May 1901), in his own 1927 letter, and in Harper's Monthly, September 1932, p. 406"),
  q("Life is like riding a bicycle. To keep your balance, you must keep moving.", "Albert Einstein", "Letter to his son Eduard, 5 February 1930"),

  // ---- Athletes, coaches and humorists (each checked against a dated or published source) ----
  q("You can observe a lot by watching.", "Yogi Berra", "The New York Times, 25 October 1963, Arthur Daley, 'Sports of the Times' (Berra, newly named manager of the Yankees)"),
  q("Little things are big.", "Yogi Berra", "What Time Is It? You Mean Now? (2003), p. 69"),
  q("If you don't know where you're going, you might not get there.", "Yogi Berra", "When You Come to a Fork in the Road, Take It! (2001), p. 53"),
  q("If you can't imitate him, don't copy him.", "Yogi Berra", "What Time Is It? You Mean Now? (2003), p. 15"),
  q("If the world were perfect, it wouldn't be.", "Yogi Berra", "When You Come to a Fork in the Road, Take It! (2001), p. 154"),
  q("Don't look back. Something might be gaining on you.", "Satchel Paige", "Collier's, 13 June 1953, Richard Donovan, 'Time Ain't Gonna Mess with Me' ('How to Stay Young' list)"),
  q("Make each day your masterpiece.", "John Wooden", "Item 3 of his father's 'Seven Things to Do', repeated by Wooden in his books and talks"),
  q("Pressure is a privilege.", "Billie Jean King", "Title and mantra of her 2008 book Pressure Is a Privilege (with Christine Brennan, LifeTime Media)"),
  q("Don't ever underestimate the heart of a champion.", "Rudy Tomjanovich", "Said after the Houston Rockets won the NBA title, 14 June 1995"),
  q("Talent wins games, but teamwork and intelligence wins championships.", "Michael Jordan", "I Can't Accept Not Trying (HarperSanFrancisco, 1994), p. 129 (his grammar, 'wins', as printed)"),
  q("Luck is the residue of design.", "Branch Rickey", "Report of a speech by Branch Rickey, Lexington, Kentucky newspaper, 1 November 1915 (Quote Investigator)"),
  q("Eighty percent of success is showing up.", "Woody Allen", "Woody Allen's own wording, confirmed in his 1989 letter to William Safire (first reported by Marshall Brickman, NYT, 21 August 1977)"),
  q("Laughter is the shortest distance between two people.", "Victor Borge", "AP interview by Vivian Brown, 30 June 1972 (The Argus, Rock Island, Illinois, p. 15)"),
];

export const FAMOUS_QUOTE_LINES: string[] = FAMOUS_QUOTES.map((x) => `${x.text} - ${x.by}`);
