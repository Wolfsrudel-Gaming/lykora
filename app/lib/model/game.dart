// Lesender Zugriff auf ein Spiel im Lykora-Spielformat v0.1.
//
// Die Klassen umhüllen das JSON aus dem Spielpaket, statt es zu kopieren. So bleibt
// das Spiel genau so erhalten, wie der Server es geliefert hat, und neue optionale
// Felder im Format brechen die App nicht. Maßgeblich ist spec/v0.1/game.schema.json.

typedef Json = Map<String, dynamic>;

List<Json> _list(Object? v) => (v as List? ?? const []).cast<Json>();
List<String> _strings(Object? v) => (v as List? ?? const []).cast<String>();
double _num(Object? v, double fallback) => (v as num?)?.toDouble() ?? fallback;

/// Text in einer Sprache oder als Übersetzungen je Sprachcode.
class LText {
  const LText(this.raw);
  final Object? raw;

  String resolve(String lang) {
    final r = raw;
    if (r == null) return '';
    if (r is String) return r;
    final map = (r as Map).cast<String, String>();
    return map[lang] ?? (map.isEmpty ? '' : map.values.first);
  }

  bool get isEmpty => raw == null || resolve('').isEmpty;
}

class GeoPoint {
  const GeoPoint(this.lat, this.lon);
  factory GeoPoint.fromJson(Json j) => GeoPoint((j['lat'] as num).toDouble(), (j['lon'] as num).toDouble());
  final double lat;
  final double lon;
  Json toJson() => {'lat': lat, 'lon': lon};
  @override
  String toString() => '${lat.toStringAsFixed(5)}, ${lon.toStringAsFixed(5)}';
}

/// Fläche als Polygon oder Kreis.
class Area {
  Area(this.json);
  final Json json;
  bool get isCircle => json.containsKey('center');
  GeoPoint get center => GeoPoint.fromJson(json['center'] as Json);
  double get radius => _num(json['radius'], 0);
  List<GeoPoint> get polygon => _list(json['polygon']).map(GeoPoint.fromJson).toList();
}

class Penalty {
  Penalty(this.json);
  final Json json;
  String get type => json['type'] as String;
  int get amount => (json['amount'] as num?)?.toInt() ?? 0;
}

class Game {
  Game(this.json);
  final Json json;

  String get id => json['id'] as String;
  Json get meta => json['meta'] as Json;
  LText get title => LText(meta['title']);
  LText get summary => LText(meta['summary']);
  List<String> get languages => _strings(meta['languages']);
  String get language => languages.isEmpty ? 'de' : languages.first;
  bool get night => meta['night'] as bool? ?? false;
  List<String> get ageGroups => _strings(meta['ageGroups']);
  String get genre => meta['genre'] as String? ?? 'other';
  int get scareLevel => (meta['scareLevel'] as num?)?.toInt() ?? 1;

  /// Nur für 6–9: Lesefassung mit Fibelschrift, Bildkarten und Hilfe von selbst
  bool get youngOnly => ageGroups.isNotEmpty && ageGroups.every((a) => a == '6-9');

  Json get presentation => json['presentation'] as Json? ?? {};

  /// Eigene Namen des Spiels für Peilgerät, Akte und Stempel; leer heißt Standard des Genres.
  LText get deviceName => LText(presentation['device']);
  LText get caseFileName => LText(presentation['caseFile']);
  LText get stampText => LText(presentation['stamp']);

  late final List<Character> characters = _list(json['characters']).map(Character.new).toList();
  late final List<Chapter> chapters = _list(story['chapters']).map(Chapter.new).toList();
  late final List<Media> mediaList = _list(json['media']).map(Media.new).toList();
  late final Map<String, Media> _media = {for (final m in mediaList) m.id: m};

  Settings get settings => Settings(json['settings'] as Json? ?? {});
  Field get field => Field(json['field'] as Json);
  Safety get safety => Safety(json['safety'] as Json);
  Json get story => json['story'] as Json? ?? {};
  LText get intro => LText((story['intro'] as Json?)?['text']);
  LText get outro => LText((story['outro'] as Json?)?['text']);
  LText get hqName => LText((story['hq'] as Json?)?['name'] ?? 'Zentrale');

  late final List<Station> stations = _list(json['stations']).map(Station.new).toList();
  late final List<Fragment> fragments = _list(json['fragments']).map(Fragment.new).toList()..sort((a, b) => a.position.compareTo(b.position));
  late final List<Item> items = _list(json['items']).map(Item.new).toList();
  List<Json> get rules => _list(json['rules']);

  Station? station(String id) {
    for (final s in stations) {
      if (s.id == id) return s;
    }
    return null;
  }

  Item? item(String id) {
    for (final i in items) {
      if (i.id == id) return i;
    }
    return null;
  }

  Character? character(String? id) {
    if (id == null) return null;
    for (final c in characters) {
      if (c.id == id) return c;
    }
    return null;
  }

  /// Die Zentrale: erste Figur mit kind hq.
  Character? get hq {
    for (final c in characters) {
      if (c.kind == 'hq') return c;
    }
    return null;
  }

  Chapter? chapter(String id) {
    for (final c in chapters) {
      if (c.id == id) return c;
    }
    return null;
  }

  Media? media(String? id) => id == null ? null : _media[id];

  /// Grund-Atmosphäre und eigene Aufnahmen statt der eingebauten Geräusche.
  GameSound get sound => GameSound(json['sound'] as Json? ?? const {});

  /// Alle Takte, in denen ein Dokument steckt, damit die Akte zeigen kann, woher es stammt.
  Iterable<(Station, Beat)> get allBeats sync* {
    for (final s in stations) {
      for (final b in s.scene.all) {
        yield (s, b);
      }
    }
  }
}

class Character {
  Character(this.json);
  final Json json;
  String get id => json['id'] as String;
  String get kind => json['kind'] as String? ?? 'npc';
  LText get name => LText(json['name']);
  LText get callSign => LText(json['callSign']);
  LText get description => LText(json['description']);
  String? get portrait => json['portrait'] as String?;
}

class Chapter {
  Chapter(this.json);
  final Json json;
  String get id => json['id'] as String;
  LText get title => LText(json['title']);
  LText get text => LText((json['piece'] as Json?)?['text']);

  /// Atmosphäre, solange dieses Kapitel läuft
  Ambience? get ambience => json['ambience'] == null ? null : Ambience(json['ambience'] as Json);
}

/// Ein Takt einer Szene, siehe beat im Schema.
class Beat {
  Beat(this.json);
  final Json json;
  String get kind => json['kind'] as String;
  String? get speaker => json['speaker'] as String?;
  LText get title => LText(json['title']);
  LText get text => LText(json['text']);
  String? get audio => json['audio'] as String?;

  /// Geräusch, das mit dem Takt einsetzt, zusätzlich zur Stimme in [audio]
  String? get sfx => json['sfx'] as String?;
  String? get image => json['image'] as String?;
  String? get item => json['item'] as String?;
  LText get ack => LText(json['ack']);
  List<BeatResponse> get responses => _list(json['responses']).map(BeatResponse.new).toList();
}

class BeatResponse {
  BeatResponse(this.json);
  final Json json;
  LText get label => LText(json['label']);
  LText get reply => LText(json['reply']);
}

class Scene {
  Scene(this.json);
  final Json json;
  List<Beat> get arrival => _list(json['arrival']).map(Beat.new).toList();
  List<Beat> get beats => _list(json['beats']).map(Beat.new).toList();
  List<Beat> get afterSolve => _list(json['afterSolve']).map(Beat.new).toList();
  List<Beat> get all => [...arrival, ...beats, ...afterSolve];
  bool get isEmpty => arrival.isEmpty && beats.isEmpty && afterSolve.isEmpty;
}

class Settings {
  Settings(this.json);
  final Json json;
  String get mode => json['mode'] as String? ?? 'competitive';
  String get winCondition => json['winCondition'] as String? ?? 'first_escape';
  Json get time => json['time'] as Json? ?? {};
  String get timeLimit => time['limit'] as String? ?? 'per_team';
  int? get duration => (time['duration'] as num?)?.toInt();
  Penalty? get wrongAnswer => json['wrongAnswer'] == null ? null : Penalty(json['wrongAnswer'] as Json);
  Json get hints => json['hints'] as Json? ?? {};
  bool get hintsEnabled => hints['enabled'] as bool? ?? true;
  List<Penalty> get defaultHintCost => _list(hints['defaultCost']).map(Penalty.new).toList();
  Json get scoring => json['scoring'] as Json? ?? {};
  int get solvePoints => (scoring['solvePoints'] as num?)?.toInt() ?? 100;
  int get streakBonus => (scoring['streakBonus'] as num?)?.toInt() ?? 0;
  String get leaderboard => json['leaderboard'] as String? ?? 'live';
  bool get showOwnPosition => json['showOwnPosition'] as bool? ?? true;
  Json get map => json['map'] as Json? ?? {};
  String? get tiles => map['tiles'] as String?;
}

class Field {
  Field(this.json);
  final Json json;
  Area get boundary => Area(json['boundary'] as Json);
  GeoPoint? get start => json['start'] == null ? null : GeoPoint.fromJson(json['start'] as Json);
  NamedPoint get assemblyPoint => NamedPoint(json['assemblyPoint'] as Json);
  List<RestrictedZone> get restrictedZones => _list(json['restrictedZones']).map(RestrictedZone.new).toList();
  List<NamedPoint> get rescuePoints => _list(json['rescuePoints']).map(NamedPoint.new).toList();
}

class NamedPoint {
  NamedPoint(this.json);
  final Json json;
  String? get id => json['id'] as String?;
  LText get name => LText(json['name']);
  LText get description => LText(json['description']);
  GeoPoint get location => GeoPoint.fromJson(json['location'] as Json);
}

class RestrictedZone {
  RestrictedZone(this.json);
  final Json json;
  String get id => json['id'] as String;
  LText get name => LText(json['name'] ?? json['id']);
  String get kind => json['kind'] as String? ?? 'other';
  Area get area => Area(json['area'] as Json);
  double get warnDistance => _num(json['warnDistance'], 15);
}

class Safety {
  Safety(this.json);
  final Json json;
  Json get emergency => json['emergency'] as Json;
  String get gameMasterPhone => emergency['gameMasterPhone'] as String;
  String get emergencyNumber => emergency['emergencyNumber'] as String? ?? '112';
  LText get emergencyNotes => LText(emergency['notes']);
  Json get heartbeat => json['heartbeat'] as Json? ?? {};
  bool get heartbeatEnabled => heartbeat['enabled'] as bool? ?? true;
  int get heartbeatInterval => (heartbeat['interval'] as num?)?.toInt() ?? 900;
  Json get sos => json['sos'] as Json? ?? {};
  String? get smsFallback => sos['smsFallback'] as String?;
  bool get loudSignal => sos['loudSignal'] as bool? ?? true;
  bool get requireSupervisor => json['requireSupervisor'] as bool? ?? true;
  List<LText> get requiredGear => (json['requiredGear'] as List? ?? const []).map(LText.new).toList();
}

class Station {
  Station(this.json);
  final Json json;
  String get id => json['id'] as String;
  LText get name => LText(json['name']);
  GeoPoint? get location => json['location'] == null ? null : GeoPoint.fromJson(json['location'] as Json);
  bool get hidden => json['visibility'] == 'hidden';
  double? get revealRadius => (json['revealRadius'] as num?)?.toDouble();
  bool get isFinal => json['final'] as bool? ?? false;
  bool get offPath => json['offPath'] as bool? ?? false;
  List<Trigger> get triggers => _list(json['triggers']).map(Trigger.new).toList();
  LText get story => LText((json['story'] as Json?)?['text']);
  List<String> get storyMedia => _strings((json['story'] as Json?)?['media']);

  /// Szene der Station; ältere Spiele ohne scene bekommen ihre story als Erzähltakt.
  Scene get scene {
    final raw = json['scene'] as Json?;
    if (raw != null) return Scene(raw);
    final st = json['story'] as Json?;
    if (st == null || st['text'] == null) return Scene(const {});
    final speaker = st['speaker'] == 'hq' ? 'radio' : 'narration';
    return Scene({
      'beats': [
        {'kind': speaker, 'text': st['text'], if ((st['media'] as List?)?.isNotEmpty ?? false) 'image': (st['media'] as List).first},
      ],
    });
  }

  /// Sprechzeile des Peilgeräts je Stufe: far, mid, near, here
  LText approach(String stage) => LText((json['approach'] as Json?)?[stage]);

  /// Atmosphäre in der Nähe, Geräusche beim Annähern und beim Lösen
  StationSound get sound => StationSound(json['sound'] as Json? ?? const {});

  Task? get task => json['task'] == null ? null : Task(json['task'] as Json);
  List<Hint> get hints => _list(json['hints']).map(Hint.new).toList();
  Json get rewards => json['rewards'] as Json? ?? {};

  Trigger? trigger(String type) {
    for (final t in triggers) {
      if (t.type == type) return t;
    }
    return null;
  }
}

class Trigger {
  Trigger(this.json);
  final Json json;
  String get type => json['type'] as String;
  double get radius => _num(json['radius'], 20);
  GeoPoint? get location => json['location'] == null ? null : GeoPoint.fromJson(json['location'] as Json);
  String? get code => json['code'] as String?;
  String? get tag => json['tag'] as String?;
}

class Task {
  Task(this.json);
  final Json json;
  String get type => json['type'] as String;
  LText get question => LText(json['question'] ?? json['prompt']);
  List<String> get answers => _strings(json['answers']);
  List<Json> get options => _list(json['options']);
  bool get shuffle => json['shuffle'] as bool? ?? true;
  bool get video => json['video'] as bool? ?? false;
  String get review => json['review'] as String? ?? 'live';
  bool get manualReview => json['manualReview'] as bool? ?? false;

  /// Zahlenschloss oder Tastatur; ohne Angabe Schloss bei reinen Ziffern bis 6 Stellen.
  bool get useLock {
    final input = json['input'] as String?;
    if (input != null) return input == 'lock';
    return type == 'code' && answers.isNotEmpty && answers.every((a) => RegExp(r'^\d{1,6}$').hasMatch(a)) && answers.map((a) => a.length).toSet().length == 1;
  }

  List<String> get media => _strings(json['media']);
  GeoPoint? get location => json['location'] == null ? null : GeoPoint.fromJson(json['location'] as Json);
}

class Hint {
  Hint(this.json);
  final Json json;
  LText get text => LText(json['text']);
  Penalty? get cost => json['cost'] == null ? null : Penalty(json['cost'] as Json);
}

class Fragment {
  Fragment(this.json);
  final Json json;
  String get id => json['id'] as String;
  int get position => (json['position'] as num).toInt();
  String get value => json['value'] as String;
  LText get label => LText(json['label']);
}

class Item {
  Item(this.json);
  final Json json;
  String get id => json['id'] as String;
  LText get name => LText(json['name']);
  LText get description => LText(json['description']);

  /// object, document oder evidence
  String get kind => json['kind'] as String? ?? 'object';
  LText get body => LText(json['body']);
  String? get image => json['image'] as String?;
  String? get icon => json['icon'] as String?;
}

/// Eine Mediendatei des Spiels; [src] ist relativ zur Server-Adresse (media/…) oder eine URL.
class Media {
  Media(this.json);
  final Json json;
  String get id => json['id'] as String;

  /// image, audio oder video
  String get type => json['type'] as String;
  String get src => json['src'] as String;
  bool get isAudio => type == 'audio';
  LText get alt => LText(json['alt']);
  LText get transcript => LText(json['transcript']);

  /// Urheber und Lizenz
  LText get credit => LText(json['credit']);
}

/// Atmosphäre: ein Geräusch in Schleife, weich ein- und ausgeblendet.
class Ambience {
  Ambience(this.json);
  final Json json;

  /// ID aus media, Typ audio
  String get audio => json['audio'] as String;
  double get volume => _num(json['volume'], 0.6);

  /// Nur an Stationen: ab dieser Peilstufe (mid, near oder here) läuft die Atmosphäre.
  String get from => json['from'] as String? ?? 'near';
}

/// Klang des ganzen Spiels, siehe sound im Schema.
class GameSound {
  GameSound(this.json);
  final Json json;
  Ambience? get ambience => json['ambience'] == null ? null : Ambience(json['ambience'] as Json);

  /// Eigene Aufnahme statt des eingebauten Geräuschs: arrival, solved, wrong, chapter, radio, hint, key
  String? ui(String key) => (json['ui'] as Json?)?[key] as String?;
}

/// Klang einer Station, siehe stationSound im Schema.
class StationSound {
  StationSound(this.json);
  final Json json;
  Ambience? get ambience => json['ambience'] == null ? null : Ambience(json['ambience'] as Json);

  /// Einmaliges Geräusch beim Erreichen der Peilstufe mid, near oder here
  String? approach(String stage) => (json['approach'] as Json?)?[stage] as String?;

  /// Geräusch beim Lösen
  String? get solved => json['solved'] as String?;
}
