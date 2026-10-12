'use strict';

// Verse für den „Vers des Tages“ – Text nach der Lutherbibel 1912 (gemeinfrei, alte Rechtschreibung).
// Jeden Tag wird automatisch der nächste Vers gezeigt; Admins können für einzelne Tage einen eigenen Vers festlegen.
const VERSES = [
  { ref: 'Psalm 23,1', text: 'Der HERR ist mein Hirte; mir wird nichts mangeln.' },
  { ref: 'Johannes 3,16', text: 'Also hat Gott die Welt geliebt, daß er seinen eingeborenen Sohn gab, auf daß alle, die an ihn glauben, nicht verloren werden, sondern das ewige Leben haben.' },
  { ref: 'Jesaja 41,10', text: 'Fürchte dich nicht, ich bin mit dir; weiche nicht, denn ich bin dein Gott; ich stärke dich, ich helfe dir auch, ich erhalte dich durch die rechte Hand meiner Gerechtigkeit.' },
  { ref: 'Philipper 4,13', text: 'Ich vermag alles durch den, der mich mächtig macht, Christus.' },
  { ref: 'Römer 8,28', text: 'Wir wissen aber, daß denen, die Gott lieben, alle Dinge zum Besten dienen, denen, die nach dem Vorsatz berufen sind.' },
  { ref: 'Sprüche 3,5', text: 'Verlaß dich auf den HERRN von ganzem Herzen, und verlaß dich nicht auf deinen Verstand.' },
  { ref: 'Josua 1,9', text: 'Siehe, ich habe dir geboten, daß du getrost und freudig seist. Laß dir nicht grauen und entsetze dich nicht; denn der HERR, dein Gott, ist mit dir in allem, was du tun wirst.' },
  { ref: 'Matthäus 11,28', text: 'Kommet her zu mir alle, die ihr mühselig und beladen seid; ich will euch erquicken.' },
  { ref: 'Psalm 46,2', text: 'Gott ist unsre Zuversicht und Stärke, eine Hilfe in den großen Nöten, die uns getroffen haben.' },
  { ref: 'Klagelieder 3,22–23', text: 'Die Güte des HERRN ist\'s, daß wir nicht gar aus sind; seine Barmherzigkeit hat noch kein Ende, sondern sie ist alle Morgen neu, und deine Treue ist groß.' },
  { ref: 'Psalm 119,105', text: 'Dein Wort ist meines Fußes Leuchte und ein Licht auf meinem Wege.' },
  { ref: 'Johannes 14,6', text: 'Jesus spricht zu ihm: Ich bin der Weg und die Wahrheit und das Leben; niemand kommt zum Vater denn durch mich.' },
  { ref: '1. Korinther 13,13', text: 'Nun aber bleibt Glaube, Hoffnung, Liebe, diese drei; aber die Liebe ist die größte unter ihnen.' },
  { ref: 'Psalm 37,5', text: 'Befiehl dem HERRN deine Wege und hoffe auf ihn; er wird\'s wohl machen.' },
  { ref: 'Matthäus 28,20', text: 'Und siehe, ich bin bei euch alle Tage bis an der Welt Ende.' },
  { ref: 'Jesaja 40,31', text: 'Aber die auf den HERRN harren, kriegen neue Kraft, daß sie auffahren mit Flügeln wie Adler, daß sie laufen und nicht matt werden, daß sie wandeln und nicht müde werden.' },
  { ref: 'Psalm 121,1–2', text: 'Ich hebe meine Augen auf zu den Bergen, von welchen mir Hilfe kommt. Meine Hilfe kommt vom HERRN, der Himmel und Erde gemacht hat.' },
  { ref: '1. Petrus 5,7', text: 'Alle eure Sorge werfet auf ihn; denn er sorgt für euch.' },
  { ref: 'Hebräer 13,8', text: 'Jesus Christus gestern und heute und derselbe auch in Ewigkeit.' },
  { ref: 'Römer 12,12', text: 'Seid fröhlich in Hoffnung, geduldig in Trübsal, haltet an am Gebet.' },
  { ref: 'Psalm 103,2', text: 'Lobe den HERRN, meine Seele, und vergiß nicht, was er dir Gutes getan hat.' },
  { ref: 'Johannes 8,12', text: 'Ich bin das Licht der Welt. Wer mir nachfolgt, der wird nicht wandeln in der Finsternis, sondern wird das Licht des Lebens haben.' },
  { ref: 'Matthäus 6,33', text: 'Trachtet am ersten nach dem Reich Gottes und nach seiner Gerechtigkeit, so wird euch solches alles zufallen.' },
  { ref: 'Galater 6,2', text: 'Einer trage des andern Last, so werdet ihr das Gesetz Christi erfüllen.' },
  { ref: 'Psalm 27,1', text: 'Der HERR ist mein Licht und mein Heil; vor wem sollte ich mich fürchten? Der HERR ist meines Lebens Kraft; vor wem sollte mir grauen?' },
  { ref: '2. Timotheus 1,7', text: 'Denn Gott hat uns nicht gegeben den Geist der Furcht, sondern der Kraft und der Liebe und der Zucht.' },
  { ref: 'Psalm 91,11', text: 'Denn er hat seinen Engeln befohlen über dir, daß sie dich behüten auf allen deinen Wegen.' },
  { ref: 'Micha 6,8', text: 'Es ist dir gesagt, Mensch, was gut ist und was der HERR von dir fordert, nämlich Gottes Wort halten und Liebe üben und demütig sein vor deinem Gott.' },
  { ref: 'Johannes 11,25', text: 'Jesus spricht zu ihr: Ich bin die Auferstehung und das Leben. Wer an mich glaubt, der wird leben, ob er gleich stürbe.' },
  { ref: 'Epheser 2,8', text: 'Denn aus Gnade seid ihr selig geworden durch den Glauben, und dasselbe nicht aus euch: Gottes Gabe ist es.' },
  { ref: 'Psalm 139,14', text: 'Ich danke dir darüber, daß ich wunderbar gemacht bin; wunderbar sind deine Werke, und das erkennt meine Seele wohl.' },
  { ref: '1. Johannes 4,16', text: 'Gott ist die Liebe; und wer in der Liebe bleibt, der bleibt in Gott und Gott in ihm.' },
  { ref: 'Philipper 4,4', text: 'Freuet euch in dem Herrn allewege! Und abermals sage ich: Freuet euch!' },
  { ref: 'Psalm 34,9', text: 'Schmecket und sehet, wie freundlich der HERR ist. Wohl dem, der auf ihn traut!' },
  { ref: 'Jesaja 43,1', text: 'Fürchte dich nicht, denn ich habe dich erlöst; ich habe dich bei deinem Namen gerufen; du bist mein!' },
  { ref: 'Matthäus 5,14', text: 'Ihr seid das Licht der Welt. Es kann die Stadt, die auf einem Berge liegt, nicht verborgen sein.' },
  { ref: 'Johannes 15,5', text: 'Ich bin der Weinstock, ihr seid die Reben. Wer in mir bleibt und ich in ihm, der bringt viel Frucht; denn ohne mich könnt ihr nichts tun.' },
  { ref: 'Römer 15,13', text: 'Der Gott aber der Hoffnung erfülle euch mit aller Freude und Frieden im Glauben, daß ihr völlige Hoffnung habet durch die Kraft des heiligen Geistes.' },
  { ref: '2. Korinther 12,9', text: 'Laß dir an meiner Gnade genügen; denn meine Kraft ist in den Schwachen mächtig.' },
  { ref: 'Johannes 16,33', text: 'In der Welt habt ihr Angst; aber seid getrost, ich habe die Welt überwunden.' },
  { ref: 'Psalm 4,9', text: 'Ich liege und schlafe ganz mit Frieden; denn allein du, HERR, hilfst mir, daß ich sicher wohne.' },
  { ref: 'Psalm 118,24', text: 'Dies ist der Tag, den der HERR macht; lasset uns freuen und fröhlich darin sein.' },
  { ref: '1. Thessalonicher 5,16–18', text: 'Seid allezeit fröhlich, betet ohne Unterlaß, seid dankbar in allen Dingen; denn das ist der Wille Gottes in Christo Jesu an euch.' },
  { ref: 'Matthäus 7,7', text: 'Bittet, so wird euch gegeben; suchet, so werdet ihr finden; klopfet an, so wird euch aufgetan.' },
  { ref: 'Psalm 145,18', text: 'Der HERR ist nahe allen, die ihn anrufen, allen, die ihn mit Ernst anrufen.' },
  { ref: 'Johannes 10,11', text: 'Ich bin der gute Hirte. Der gute Hirte läßt sein Leben für die Schafe.' },
  { ref: 'Sprüche 16,9', text: 'Des Menschen Herz schlägt seinen Weg an; aber der HERR allein gibt, daß er fortgehe.' },
  { ref: 'Jesaja 54,10', text: 'Denn es sollen wohl Berge weichen und Hügel hinfallen; aber meine Gnade soll nicht von dir weichen, und der Bund meines Friedens soll nicht hinfallen, spricht der HERR, dein Erbarmer.' },
  { ref: 'Psalm 73,23', text: 'Dennoch bleibe ich stets an dir; denn du hältst mich bei meiner rechten Hand.' },
  { ref: 'Matthäus 5,9', text: 'Selig sind die Friedfertigen; denn sie werden Gottes Kinder heißen.' },
  { ref: 'Johannes 13,34', text: 'Ein neu Gebot gebe ich euch, daß ihr euch untereinander liebet, wie ich euch geliebt habe, auf daß auch ihr einander liebhabet.' },
  { ref: 'Psalm 100,2', text: 'Dienet dem HERRN mit Freuden; kommt vor sein Angesicht mit Frohlocken!' },
  { ref: 'Psalm 62,2', text: 'Meine Seele ist stille zu Gott, der mir hilft.' },
  { ref: 'Kolosser 3,17', text: 'Und alles, was ihr tut mit Worten oder mit Werken, das tut alles in dem Namen des HERRN Jesu, und danket Gott und dem Vater durch ihn.' },
  { ref: 'Hebräer 11,1', text: 'Es ist aber der Glaube eine gewisse Zuversicht des, das man hofft, und ein Nichtzweifeln an dem, das man nicht sieht.' },
  { ref: 'Psalm 103,8', text: 'Barmherzig und gnädig ist der HERR, geduldig und von großer Güte.' },
];

// Fortlaufende Tagesnummer → jeden Tag der nächste Vers, für alle gleich.
function verseForDate(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const day = Math.floor(Date.UTC(y, m - 1, d) / 86400000);
  return VERSES[((day % VERSES.length) + VERSES.length) % VERSES.length];
}

module.exports = { VERSES, verseForDate };
