// Klanglandschaft: Atmosphäre in Schleife, Geräusche an Stationen und Cues der Spielleitung.
//
// Die Atmosphäre läuft auf zwei Spuren, damit ein Wechsel weich überblendet. Welche gerade läuft,
// entscheidet chooseAmbience: Szene einer Station vor angepeilter Station (ab ihrer Stufe from)
// vor laufendem Kapitel vor Spiel. Spricht eine Stimme, wird sie leiser; ein Sicherheitsalarm
// bringt alles sofort zum Schweigen, danach blendet sie wieder ein. Beides meldet Fx.

import 'dart:async';
import 'dart:io';
import 'dart:math' as math;

import 'package:audioplayers/audioplayers.dart';

import '../data/controller.dart';
import '../data/peiler.dart';
import '../data/session.dart';
import '../engine/geo.dart';
import '../model/game.dart';
import 'fx.dart';

/// Peilstufe, ab der die Atmosphäre einer Station läuft; ohne Angabe ab „nah“.
PeilStage ambienceFrom(String from) => switch (from) {
  'mid' => PeilStage.mid,
  'here' => PeilStage.here,
  _ => PeilStage.near,
};

/// Atmosphäre für die Lage im Spiel; null heißt Stille.
///
/// [scene] ist die Station, deren Szene offen ist; [target] und [stage] meldet der Peiler.
/// [has] sagt, ob die Datei auf dem Gerät liegt; fehlt sie, gilt die nächste Ebene.
Ambience? chooseAmbience(Game game, {String? scene, String? target, PeilStage? stage, Chapter? chapter, bool Function(String audio)? has}) {
  bool ok(Ambience? a) => a != null && (has == null || has(a.audio));
  final inScene = scene == null ? null : game.station(scene)?.sound.ambience;
  if (ok(inScene)) return inScene;
  final near = target == null ? null : game.station(target)?.sound.ambience;
  if (near != null && stage != null && stage.index >= ambienceFrom(near.from).index && ok(near)) return near;
  final inChapter = chapter?.ambience;
  if (ok(inChapter)) return inChapter;
  final base = game.sound.ambience;
  return ok(base) ? base : null;
}

/// Ausgabe der Klanglandschaft: zwei Spuren für die Atmosphäre, dazu Einmal-Geräusche.
/// Die echte spielt über audioplayers; Tests setzen eine eigene ein.
abstract class SoundDeck {
  /// Startet [file] auf Spur [track] (0 oder 1) in Schleife.
  Future<void> loop(int track, File file, double volume);
  Future<void> volume(int track, double volume);
  Future<void> stop(int track);

  /// Spielt [file] einmal; endet, wenn das Geräusch verklungen ist oder abgebrochen wurde.
  Future<void> once(File file, double volume);

  /// Bricht alle Einmal-Geräusche ab.
  Future<void> stopOnce();
}

/// Ohne Plugins, etwa in Widget-Tests: spielt nichts.
class SilentDeck implements SoundDeck {
  const SilentDeck();
  @override
  Future<void> loop(int track, File file, double volume) async {}
  @override
  Future<void> volume(int track, double volume) async {}
  @override
  Future<void> stop(int track) async {}
  @override
  Future<void> once(File file, double volume) async {}
  @override
  Future<void> stopOnce() async {}
}

/// Spielt über audioplayers. Alle Spieler mischen sich und laufen bei gesperrtem Bildschirm weiter,
/// damit die Atmosphäre auch im Taschenmodus bleibt.
///
/// Befehle an einen Spieler laufen nacheinander: Ein Anhalten, das kommt, während die Spur noch startet,
/// greift erst danach. Sonst liefe eine Schleife unbemerkt weiter und hielte das Handy wach.
class AudioDeck implements SoundDeck {
  late final _tracks = [newPlayer(), newPlayer()];

  /// Zuletzt gewünschte Lautstärke je Spur; die Blende kann sie verstellen, während die Spur noch startet.
  final _level = [0.0, 0.0];
  final _once = <AudioPlayer>[];
  final _done = <AudioPlayer, Completer<void>>{};
  final _queue = <AudioPlayer, Future<void>>{};
  int _next = 0;

  /// Hängt [op] an die Befehle von [p] an; ein Fehler hält die folgenden nicht auf.
  Future<void> _run(AudioPlayer p, Future<void> Function() op) => _queue[p] = (_queue[p] ?? Future<void>.value()).then((_) async {
    try {
      await op();
    } catch (_) {}
  });

  /// Hält [p] gleich an, damit ein Start, der gerade läuft, nicht mehr losspielt, und noch einmal nach
  /// allen Befehlen davor, falls einer erst danach starten wollte.
  Future<void> _halt(AudioPlayer p) {
    unawaited(p.stop().catchError((Object _) {}));
    return _run(p, p.stop);
  }

  @override
  Future<void> loop(int track, File file, double volume) {
    final p = _tracks[track];
    _level[track] = volume;
    return _run(p, () async {
      await p.stop();
      await p.setReleaseMode(ReleaseMode.loop);
      await p.play(DeviceFileSource(file.path), volume: _level[track], ctx: mixAudio, mode: PlayerMode.mediaPlayer);
      await p.setVolume(_level[track]);
    });
  }

  @override
  Future<void> volume(int track, double volume) async {
    _level[track] = volume;
    try {
      await _tracks[track].setVolume(volume);
    } catch (_) {}
  }

  @override
  Future<void> stop(int track) => _halt(_tracks[track]);

  /// Ein freier Spieler, höchstens drei; sind alle belegt, weicht reihum ein laufendes Geräusch.
  AudioPlayer _player() {
    for (final p in _once) {
      if (!_done.containsKey(p)) return p;
    }
    if (_once.length < 3) {
      final p = newPlayer();
      p.onPlayerComplete.listen((_) => _finish(p), onError: (Object _) => _finish(p));
      _once.add(p);
      return p;
    }
    return _once[_next++ % _once.length];
  }

  void _finish(AudioPlayer p) => _done.remove(p)?.complete();

  @override
  Future<void> once(File file, double volume) {
    final p = _player();
    _finish(p);
    final done = _done[p] = Completer<void>();
    unawaited(
      _run(p, () async {
        // Inzwischen abgebrochen (Alarm) oder verdrängt: nicht mehr starten.
        if (_done[p] != done) return;
        try {
          await p.stop();
          await p.play(DeviceFileSource(file.path), volume: volume, ctx: mixAudio, mode: PlayerMode.mediaPlayer);
        } catch (_) {
          if (_done[p] == done) _finish(p);
        }
      }),
    );
    return done.future;
  }

  @override
  Future<void> stopOnce() {
    _once.forEach(_finish);
    return Future.wait(_once.map(_halt));
  }
}

/// Eine Spur der Atmosphäre mit aktueller und angestrebter Lautstärke.
class _Track {
  String? audio;
  double volume = 0;
  double target = 0;
  double step = 0;

  /// Lautstärke [to] in [over] erreichen; [tick] ist der Takt der Blende.
  void fade(double to, Duration over, Duration tick) {
    target = to;
    final steps = math.max(1, over.inMicroseconds ~/ math.max(1, tick.inMicroseconds));
    step = (to - volume).abs() / steps;
  }

  void clear() {
    audio = null;
    volume = 0;
    target = 0;
  }
}

/// Spielt die Atmosphäre zur Lage im Spiel und die Einmal-Geräusche. Bildschirme melden Szene, Peiler
/// und Stille an; Spiel, Kapitel, Position und Cues kommen von der Steuerung, an die sie in main.dart hängt.
class Soundscape {
  Soundscape({
    SoundDeck? deck,
    this.fade = const Duration(milliseconds: 2500),
    this.duckFade = const Duration(milliseconds: 400),
    this.tick = const Duration(milliseconds: 100),
    this.cueMaxLength = const Duration(minutes: 3),
  }) : deck = deck ?? const SilentDeck() {
    Fx.instance.addListener(_onFx);
  }

  /// Ohne Plugins (Widget-Tests) mit stummer Ausgabe.
  static final instance = Soundscape(deck: Fx.enabled ? AudioDeck() : null);

  final SoundDeck deck;

  /// Dauer der Überblendung zwischen zwei Atmosphären
  final Duration fade;

  /// Dauer, bis die Atmosphäre unter einer Stimme leiser oder danach wieder lauter ist
  final Duration duckFade;
  final Duration tick;

  /// So lange wartet die Atmosphäre höchstens unter einem Cue; meldet die Ausgabe das Ende nie
  /// (kaputte Datei), kommt sie danach trotzdem wieder hoch.
  final Duration cueMaxLength;

  /// Anteil der Lautstärke, solange eine Stimme spricht
  static const duckLevel = 0.3;

  /// Cues, die älter sind, kamen nach einer Funkstille an und bleiben still.
  static const cueMaxAge = Duration(minutes: 2);

  double _volume = 0.8;
  GameController? _c;
  StreamSubscription<ChatMessage>? _incoming;
  final _scenes = <Object, String?>{};
  final _peils = <Object, (String, PeilStage)?>{};
  final _hush = <Object>{};
  final _tracks = [_Track(), _Track()];
  int _active = 0;
  Timer? _ticker;
  bool _alarm = false;
  (String, PeilStage)? _approached;
  DateTime _approachedAt = DateTime(0);

  /// Peilt selbst, solange kein Peiler zu sehen ist (Karte, Liste).
  final _peiler = Peiler();

  /// Lautstärke der Atmosphäre aus den Einstellungen, 0 bis 1.
  double get volume => _volume;
  set volume(double v) {
    _volume = v.clamp(0.0, 1.0);
    _apply();
  }

  /// Atmosphäre, die gerade läuft oder einblendet; null heißt Stille oder Ausblenden.
  String? get playing => _tracks[_active].target > 0 ? _tracks[_active].audio : null;

  /// Angestrebte Lautstärke der laufenden Atmosphäre.
  double get level => _tracks[_active].target;

  /// Hört auf Spiel, Kapitel und eingehende Cues der Steuerung.
  void attach(GameController c) {
    detach();
    _c = c;
    c.addListener(_apply);
    _incoming = c.incoming.listen(_onMessage);
    Fx.instance.custom = _custom;
    _apply();
  }

  void detach() {
    final c = _c;
    if (c == null) return;
    c.removeListener(_apply);
    _incoming?.cancel();
    _incoming = null;
    _c = null;
    if (Fx.instance.custom == _custom) Fx.instance.custom = null;
    _apply();
  }

  void dispose() {
    detach();
    Fx.instance.removeListener(_onFx);
    _silence();
  }

  /// Ein Bildschirm zeigt die Szene von [station] oder keine mehr (null). Der zuletzt angemeldete gewinnt,
  /// z. B. eine Station über der Startseite.
  void scene(Object owner, String? station) {
    if (_scenes.containsKey(owner) && _scenes[owner] == station) return;
    _scenes[owner] = station;
    _apply();
  }

  /// Ein Peiler meldet Ziel und Stufe, null heißt kein Ziel. Der zuletzt angemeldete gewinnt.
  void peil(Object owner, String? target, PeilStage? stage) {
    final now = target == null || stage == null ? null : (target, stage);
    if (_peils.containsKey(owner) && _peils[owner] == now) return;
    _peils[owner] = now;
    _apply();
  }

  /// Solange [owner] es will, schweigt die Atmosphäre, z. B. auf der SOS-Seite.
  void hush(Object owner, bool quiet) {
    if (quiet ? _hush.add(owner) : _hush.remove(owner)) _apply();
  }

  /// Bildschirm geschlossen: Szene, Peiler und Stille dieses Bildschirms vergessen.
  void release(Object owner) {
    final scene = _scenes.remove(owner);
    final peil = _peils.remove(owner);
    final hushed = _hush.remove(owner);
    if (scene != null || peil != null || hushed) _apply();
  }

  /// Einmal-Geräusch, z. B. beat.sfx oder ein Geräusch beim Annähern; still ohne Datei oder während eines Alarms.
  Future<void> effect(File? file, {double volume = 0.9}) async {
    if (file == null || !Fx.instance.sound || Fx.instance.safetyActive) return;
    try {
      await deck.once(file, volume);
    } catch (_) {}
  }

  /// Peilstufe erreicht: Geräusch der Station dazu. Melden zwei Peiler dieselbe Stufe kurz nacheinander
  /// (Startseite unter einer Station), spielt es nur einmal.
  Future<void> approach(String station, PeilStage stage, File? file) async {
    final now = DateTime.now();
    if (_approached == (station, stage) && now.difference(_approachedAt) < const Duration(seconds: 5)) return;
    _approached = (station, stage);
    _approachedAt = now;
    await effect(file);
  }

  /// Station gelöst: ihr eigenes Geräusch, sonst der Erfolgston des Spiels oder der eingebaute.
  Future<void> solved(File? stationSound) => stationSound == null ? Fx.instance.play(Sound.solved) : effect(stationSound);

  /// Cue der Spielleitung: Klang aus dem Spiel oder nachgeladen; die Atmosphäre duckt sich darunter.
  /// Nie während eines Sicherheitsalarms.
  Future<void> playCue(Cue cue) async {
    final c = _c;
    final fx = Fx.instance;
    if (c == null || !fx.sound || fx.safetyActive) return;
    final voice = Object();
    try {
      final file = await c.cueFile(cue);
      // Das Nachladen dauert; inzwischen kann ein Alarm laufen.
      if (file == null || fx.safetyActive || !fx.sound) return;
      fx.duck(voice);
      await deck.once(file, cue.volume).timeout(cueMaxLength, onTimeout: () {});
    } catch (_) {
      // Kein Speicherplatz, kaputte Datei: Der Cue fällt aus, das Spiel läuft weiter.
    } finally {
      fx.unduck(voice);
    }
  }

  void _onMessage(ChatMessage m) {
    final cue = m.cue;
    final c = _c;
    if (cue == null || c == null) return;
    if (c.now() - m.at.millisecondsSinceEpoch > cueMaxAge.inMilliseconds) return;
    unawaited(playCue(cue));
  }

  bool _custom(Sound s, double volume) {
    final c = _c;
    final key = uiSoundKeys[s];
    final game = c?.game;
    if (c == null || game == null || key == null) return false;
    final file = c.mediaFile(game.sound.ui(key));
    if (file == null) return false;
    unawaited(deck.once(file, volume).catchError((Object _) {}));
    return true;
  }

  void _onFx() {
    final alarm = Fx.instance.safetyActive;
    if (alarm && !_alarm) _silence();
    _alarm = alarm;
    _apply();
  }

  /// Sicherheitsalarm oder Ende: sofort Stille, ohne Ausblenden.
  void _silence() {
    _ticker?.cancel();
    _ticker = null;
    for (var i = 0; i < _tracks.length; i++) {
      if (_tracks[i].audio != null) unawaited(deck.stop(i));
      _tracks[i].clear();
    }
    unawaited(deck.stopOnce());
  }

  /// Gewünschte Atmosphäre ohne Rücksicht auf Ton und Alarm. Während eines Rückrufs schweigt sie auch,
  /// wenn das Team den Alarm schon bestätigt hat.
  Ambience? _wanted() {
    final c = _c;
    final game = c?.game;
    if (c == null || game == null || !c.started || c.eventEnded || c.recalled || _hush.isNotEmpty) return null;
    final scene = _scenes.values.whereType<String>().lastOrNull;
    // Nach dem Finale nur noch in dessen Szene.
    if (c.finished && scene == null) return null;
    final peil = _peil(c);
    return chooseAmbience(game, scene: scene, target: peil?.$1, stage: peil?.$2, chapter: c.currentChapter, has: (id) => c.mediaFile(id) != null);
  }

  /// Ziel und Stufe vom zuletzt gemeldeten Peiler. Ist keiner zu sehen (Karte, Liste), peilt die
  /// Klanglandschaft das nächste Ziel selbst an, mit derselben Hysterese wie der Peiler.
  (String, PeilStage)? _peil(GameController c) {
    final shown = _peils.values.whereType<(String, PeilStage)>().lastOrNull;
    if (shown != null) {
      // Den eigenen Peiler mitführen, damit die Stufe beim Wechsel auf die Karte nicht springt.
      _peiler
        ..target = shown.$1
        ..stage = shown.$2;
      return shown;
    }
    final target = c.nextTarget;
    if (target == null) return null;
    final triggered = c.state.triggered.contains(target.id);
    final gps = target.trigger('gps');
    final loc = gps?.location ?? target.location;
    final pos = c.position;
    if (pos == null || loc == null) return triggered ? (target.id, PeilStage.here) : null;
    return (target.id, _peiler.update(target.id, distance(pos, loc), radius: gps?.radius ?? 20, triggered: triggered));
  }

  void _apply() {
    final fx = Fx.instance;
    var want = fx.safetyActive || !fx.sound ? null : _wanted();
    final file = want == null ? null : _c?.mediaFile(want.audio);
    final level = file == null ? 0.0 : want!.volume * _volume * (fx.ducked ? duckLevel : 1);
    if (level <= 0) want = null;
    final active = _tracks[_active];
    if (want != null && active.audio == want.audio) {
      // Gleiche Atmosphäre, nur lauter oder leiser: Stimme, Einstellung, andere Ebene mit eigenem Pegel.
      if (active.target != level) active.fade(level, duckFade, tick);
    } else {
      // Andere Atmosphäre oder Stille: die laufende aus-, die neue auf der freien Spur einblenden.
      if (active.audio != null) active.fade(0, fade, tick);
      if (want != null) {
        // Die freie Spur nehmen. Sind beide belegt (Wechsel mitten in einer Blende), bricht die leisere ab.
        var i = 1 - _active;
        final other = _tracks[i];
        if (other.audio != null && other.audio != want.audio && active.volume < other.volume) i = _active;
        final next = _tracks[i];
        if (next.audio != want.audio) {
          if (next.audio != null) unawaited(deck.stop(i));
          next
            ..clear()
            ..audio = want.audio;
          unawaited(deck.loop(i, file!, 0));
        }
        next.fade(level, fade, tick);
        _active = i;
      }
    }
    // Der Takt läuft nur, solange sich etwas bewegt oder eine ausgeblendete Spur noch aufhören muss.
    if (_ticker == null && _tracks.any((t) => t.audio != null && (t.volume != t.target || t.target == 0))) {
      _ticker = Timer.periodic(tick, (_) => _step());
    }
  }

  /// Ein Takt der Blende; ausgeblendete Spuren hören ganz auf.
  void _step() {
    var moving = false;
    for (var i = 0; i < _tracks.length; i++) {
      final t = _tracks[i];
      if (t.audio == null) continue;
      if (t.volume != t.target) {
        t.volume = t.volume < t.target ? math.min(t.target, t.volume + t.step) : math.max(t.target, t.volume - t.step);
        unawaited(deck.volume(i, t.volume));
      }
      if (t.volume == 0 && t.target == 0) {
        unawaited(deck.stop(i));
        t.clear();
      } else if (t.volume != t.target) {
        moving = true;
      }
    }
    if (!moving) {
      _ticker?.cancel();
      _ticker = null;
    }
  }
}
