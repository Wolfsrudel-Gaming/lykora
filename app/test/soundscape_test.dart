// Klanglandschaft: welche Atmosphäre läuft, Überblenden, Ducking, Sicherheitsalarm, eigene Geräusche und Cues.
// Abgespielt wird nichts; eine aufzeichnende Ausgabe zeigt, was die Klanglandschaft täte.

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lykora/app.dart';
import 'package:lykora/data/controller.dart';
import 'package:lykora/data/peiler.dart';
import 'package:lykora/data/session.dart';
import 'package:lykora/model/game.dart';
import 'package:lykora/services/fx.dart';
import 'package:lykora/services/soundscape.dart';

import 'support.dart';

/// Schreibt mit, statt zu spielen. Einmal-Geräusche enden erst, wenn [hold] fertig ist.
class FakeDeck implements SoundDeck {
  final loops = <int, String>{};
  final volumes = [0.0, 0.0];
  final played = <(String, double)>[];
  final log = <String>[];

  /// Schleifen, die hörbar liefen, als sie gestoppt wurden: ein Klick statt einer Blende
  final cuts = <String>[];
  int volumeCalls = 0;
  Completer<void>? hold;

  /// Ausgabe kaputt: Einmal-Geräusche werfen.
  bool fail = false;

  String _name(File f) => f.uri.pathSegments.last;

  @override
  Future<void> loop(int track, File file, double volume) async {
    loops[track] = _name(file);
    volumes[track] = volume;
    log.add('loop $track ${_name(file)}');
  }

  @override
  Future<void> volume(int track, double volume) async {
    volumeCalls++;
    volumes[track] = volume;
  }

  @override
  Future<void> stop(int track) async {
    final audio = loops.remove(track);
    if (audio != null && volumes[track] > 0) cuts.add(audio);
    log.add('stop $track');
  }

  @override
  Future<void> once(File file, double volume) async {
    if (fail) throw const FileSystemException('kaputt');
    played.add((_name(file), volume));
    await hold?.future;
  }

  @override
  Future<void> stopOnce() async {
    log.add('stopOnce');
    if (!(hold?.isCompleted ?? true)) hold!.complete();
  }

  /// Was gerade hörbar in Schleife läuft
  Set<String> get audible => {
    for (final e in loops.entries)
      if (volumes[e.key] > 0) e.value,
  };
}

Future<void> wait([int ms = 120]) => Future<void>.delayed(Duration(milliseconds: ms));

void main() {
  // Vorlesestimme und audioplayers sprechen über Plattformkanäle, die die Tests nachbauen.
  TestWidgetsFlutterBinding.ensureInitialized();
  final game = Game(gameJson);
  final chapter3 = game.chapter('kapitel-3');

  group('Welche Atmosphäre läuft', () {
    test('Spiel, wenn sonst nichts gilt', () {
      expect(chooseAmbience(game)?.audio, 'wind');
      expect(chooseAmbience(game, chapter: game.chapter('kapitel-1'))?.audio, 'wind', reason: 'Kapitel ohne eigene Atmosphäre');
      expect(chooseAmbience(Game({...gameJson}..remove('sound'))), isNull);
    });

    test('Kapitel vor Spiel', () {
      final a = chooseAmbience(game, chapter: chapter3)!;
      expect(a.audio, 'sturm');
      expect(a.volume, 0.5);
    });

    test('angepeilte Station erst ab ihrer Stufe', () {
      // baum: from near
      expect(chooseAmbience(game, target: 'baum', stage: PeilStage.far, chapter: chapter3)?.audio, 'sturm');
      expect(chooseAmbience(game, target: 'baum', stage: PeilStage.mid, chapter: chapter3)?.audio, 'sturm');
      expect(chooseAmbience(game, target: 'baum', stage: PeilStage.near, chapter: chapter3)?.audio, 'wald-nacht');
      expect(chooseAmbience(game, target: 'baum', stage: PeilStage.here, chapter: chapter3)?.audio, 'wald-nacht');
      // schloss: from mid
      expect(chooseAmbience(game, target: 'schloss', stage: PeilStage.far)?.audio, 'wind');
      expect(chooseAmbience(game, target: 'schloss', stage: PeilStage.mid)?.audio, 'bach');
      // Ohne Stufe zählt der Peiler nicht; Station ohne Atmosphäre auch nicht.
      expect(chooseAmbience(game, target: 'baum')?.audio, 'wind');
      expect(chooseAmbience(game, target: 'finale', stage: PeilStage.here)?.audio, 'wind');
    });

    test('from here und Standard nah', () {
      final g = Game(jsonDecode(jsonEncode(gameJson)) as Map<String, dynamic>);
      final sound = (g.json['stations'] as List).cast<Map>().firstWhere((s) => s['id'] == 'baum')['sound'] as Map;
      (sound['ambience'] as Map)['from'] = 'here';
      expect(chooseAmbience(g, target: 'baum', stage: PeilStage.near)?.audio, 'wind');
      expect(chooseAmbience(g, target: 'baum', stage: PeilStage.here)?.audio, 'wald-nacht');
      (sound['ambience'] as Map).remove('from');
      expect(chooseAmbience(g, target: 'baum', stage: PeilStage.mid)?.audio, 'wind');
      expect(chooseAmbience(g, target: 'baum', stage: PeilStage.near)?.audio, 'wald-nacht');
      expect(ambienceFrom('mid'), PeilStage.mid);
      expect(ambienceFrom('unbekannt'), PeilStage.near);
    });

    test('Szene vor allem anderen, auch ohne Peilstufe', () {
      expect(chooseAmbience(game, scene: 'schloss', target: 'baum', stage: PeilStage.here, chapter: chapter3)?.audio, 'bach');
      // Szene ohne eigene Atmosphäre: weiter mit Peiler, Kapitel, Spiel.
      expect(chooseAmbience(game, scene: 'briefing', target: 'baum', stage: PeilStage.near)?.audio, 'wald-nacht');
      expect(chooseAmbience(game, scene: 'briefing', chapter: chapter3)?.audio, 'sturm');
    });

    test('fehlt die Datei, gilt die nächste Ebene', () {
      bool has(String id) => id != 'bach' && id != 'sturm';
      expect(chooseAmbience(game, scene: 'schloss', chapter: chapter3, has: has)?.audio, 'wind');
      expect(chooseAmbience(game, has: (_) => false), isNull);
    });
  });

  group('Klanglandschaft', () {
    late FakeServer server;
    late GameController c;
    late FakeDeck deck;
    late Soundscape s;
    final owner = Object();
    final screen = Object();

    setUp(() async {
      server = FakeServer();
      c = await newController(server, backgroundLoops: false);
      await c.start();
      deck = FakeDeck();
      s = Soundscape(
        deck: deck,
        fade: const Duration(milliseconds: 40),
        duckFade: const Duration(milliseconds: 20),
        tick: const Duration(milliseconds: 4),
        cueMaxLength: const Duration(milliseconds: 150),
      )..attach(c);
    });

    tearDown(() {
      s.dispose();
      Fx.instance
        ..safetyCleared()
        ..sound = true;
    });

    test('blendet zwischen Spiel, Station und Szene über', () async {
      expect(s.playing, 'wind');
      expect(s.level, closeTo(0.35 * 0.8, 1e-9));
      await wait();
      expect(deck.audible, {'wind'});

      s.peil(owner, 'baum', PeilStage.mid);
      expect(s.playing, 'wind');
      s.peil(owner, 'baum', PeilStage.near);
      expect(s.playing, 'wald-nacht');
      await wait();
      expect(deck.audible, {'wald-nacht'}, reason: 'alte Spur ist ausgeblendet und gestoppt');
      expect(deck.loops.values, ['wald-nacht']);

      s.scene(screen, 'schloss');
      expect(s.playing, 'bach');
      s.release(screen);
      expect(s.playing, 'wald-nacht', reason: 'zurück, noch während die Blende läuft');
      await wait();
      expect(deck.audible, {'wald-nacht'});
      expect(deck.log.where((l) => l.startsWith('loop')).map((l) => l.split(' ').last), ['wind', 'wald-nacht', 'bach'], reason: 'Rückweg ohne Neustart');

      s.release(owner);
      expect(s.playing, 'wind');
    });

    test('Wechsel mitten in der Blende: die leisere Spur bricht ab, keine Schleife läuft doppelt', () async {
      await wait();
      expect(deck.audible, {'wind'});
      // Station kommt in Hörweite und gleich darauf öffnet eine Szene: wald-nacht ist noch stumm, wind noch laut.
      s.peil(owner, 'baum', PeilStage.near);
      s.scene(screen, 'schloss');
      expect(s.playing, 'bach');
      expect(deck.loops.values, unorderedEquals(['wind', 'bach']), reason: 'zwei Spuren, jede Atmosphäre einmal');
      await wait();
      expect(deck.audible, {'bach'});
      expect(deck.loops.values, ['bach']);
      expect(deck.log, ['loop 1 wind', 'loop 0 wald-nacht', 'stop 0', 'loop 0 bach', 'stop 1']);
      expect(deck.cuts, isEmpty, reason: 'wind blendet aus, statt abzureißen');
    });

    test('der Takt der Blende hört auf, wenn nichts mehr blendet; dispose stoppt alles', () async {
      await wait();
      final settled = deck.volumeCalls;
      expect(settled, greaterThan(0));
      await wait(60);
      expect(deck.volumeCalls, settled, reason: 'kein Takt ohne Blende');
      s.peil(owner, 'baum', PeilStage.near);
      await wait();
      final again = deck.volumeCalls;
      expect(again, greaterThan(settled));
      // Sekundentakt der Steuerung und neue Meldungen derselben Stufe starten keine neue Blende.
      s.peil(owner, 'baum', PeilStage.here);
      c.choosePeilTarget(null);
      await wait(60);
      expect(deck.volumeCalls, again);
      expect(deck.log.where((l) => l.startsWith('loop')), hasLength(2));
      s.dispose();
      expect(deck.loops, isEmpty);
      expect(deck.log.last, 'stopOnce');
    });

    test('ohne sichtbaren Peiler peilt die Klanglandschaft selbst, mit Hysterese', () async {
      c.choosePeilTarget('baum');
      // baum: nah ab 60 m, wieder unterwegs erst hinter 70 m
      Future<void> at(double metersNorth) => c.onPosition(50.816 + metersNorth / 111320, 7.1565, 5);
      await at(100);
      expect(s.playing, 'wind', reason: 'unterwegs; baum hat Atmosphäre erst ab nah');
      await at(50);
      expect(s.playing, 'wald-nacht');
      await at(65);
      expect(s.playing, 'wald-nacht', reason: 'zwischen Eintritt und Austritt bleibt die Stufe');
      await at(80);
      expect(s.playing, 'wind');
      await at(65);
      expect(s.playing, 'wind');
      // Ein sichtbarer Peiler hat Vorrang; geht das Team zur Karte, springt die Stufe nicht.
      s.peil(owner, 'baum', PeilStage.near);
      expect(s.playing, 'wald-nacht');
      s.release(owner);
      expect(s.playing, 'wald-nacht', reason: 'bei 65 m bleibt nah wie im Peiler');
    });

    test('Rückruf: Atmosphäre bleibt aus, auch nach dem Bestätigen', () async {
      expect(s.playing, 'wind');
      server.status = 'recalled';
      await c.sync();
      expect(c.recalled, isTrue);
      expect(s.playing, isNull);
      server.status = 'running';
      await c.sync();
      expect(s.playing, 'wind');
    });

    test('der zuletzt gemeldete Peiler gewinnt', () {
      final home = Object();
      final station = Object();
      s.peil(home, 'baum', PeilStage.near);
      s.peil(station, 'schloss', PeilStage.mid);
      expect(s.playing, 'bach');
      s.peil(home, 'baum', PeilStage.here);
      expect(s.playing, 'bach', reason: 'Startseite liegt unter der Station');
      s.release(station);
      expect(s.playing, 'wald-nacht');
    });

    test('Kapitel und Ende des Spiels', () async {
      await c.trigger('schloss', 'qr');
      await c.answer('schloss', {'text': '372'});
      expect(c.currentChapter!.id, 'kapitel-3');
      expect(s.playing, 'sturm');
      expect(s.level, closeTo(0.5 * 0.8, 1e-9));
      server.status = 'ended';
      await c.sync();
      expect(s.playing, isNull);
    });

    test('Stimme duckt die Atmosphäre, danach kommt sie zurück', () async {
      await wait();
      final voice = Object();
      addTearDown(() => Fx.instance.unduck(voice));
      Fx.instance.duck(voice);
      expect(s.playing, 'wind');
      expect(s.level, closeTo(0.35 * 0.8 * Soundscape.duckLevel, 1e-9));
      await wait();
      final track = deck.loops.keys.single;
      expect(deck.volumes[track], closeTo(0.35 * 0.8 * Soundscape.duckLevel, 1e-9));
      expect(deck.log.where((l) => l.startsWith('loop')), hasLength(1), reason: 'gleiche Schleife läuft weiter');
      Fx.instance.unduck(voice);
      await wait();
      expect(deck.volumes[track], closeTo(0.35 * 0.8, 1e-9));
    });

    test('Lautstärke aus den Einstellungen, Geräusche aus', () async {
      s.volume = 0.5;
      expect(s.level, closeTo(0.35 * 0.5, 1e-9));
      s.volume = 0;
      expect(s.playing, isNull);
      s.volume = 0.8;
      expect(s.playing, 'wind');
      Fx.instance.sound = false;
      await wait();
      expect(deck.loops, isEmpty);
      Fx.instance.sound = true;
      expect(s.playing, 'wind');
    });

    test('Sicherheitsalarm: sofort alles still, danach geht es weiter', () async {
      await wait();
      deck.hold = Completer<void>();
      final effect = s.effect(c.mediaFile('eule'));
      await Fx.instance.safetyAlarm();
      expect(deck.loops, isEmpty, reason: 'ohne Ausblenden gestoppt');
      expect(s.playing, isNull);
      expect(deck.log, contains('stopOnce'));
      await effect;
      // Während des Alarms bleiben Geräusche, eigene Aufnahmen und Cues still, und keine Atmosphäre startet.
      deck.played.clear();
      deck.log.clear();
      await s.effect(c.mediaFile('eule'));
      await s.playCue(const Cue(audio: 'eule'));
      await Fx.instance.play(Sound.squelchOn);
      s.scene(screen, 'schloss');
      await wait();
      expect(deck.played, isEmpty);
      expect(deck.log, isEmpty);
      expect(Fx.instance.ducked, isFalse);
      s.release(screen);
      Fx.instance.safetyCleared();
      expect(s.playing, 'wind');
      await wait();
      expect(deck.audible, {'wind'});
    });

    test('Geräusch beim Annähern einmal, auch wenn zwei Peiler es melden', () async {
      final eule = c.mediaFile(game.station('baum')!.sound.approach('near'));
      await s.approach('baum', PeilStage.near, eule);
      await s.approach('baum', PeilStage.near, eule);
      expect(deck.played, [('eule', 0.9)]);
      await s.approach('finale', PeilStage.near, c.mediaFile(game.station('finale')!.sound.approach('near')));
      await s.approach('baum', PeilStage.mid, null);
      expect(deck.played.map((p) => p.$1), ['eule', 'donner']);
    });

    test('SOS-Seite lässt die Atmosphäre schweigen', () {
      final sos = Object();
      s.hush(sos, true);
      expect(s.playing, isNull);
      s.release(sos);
      expect(s.playing, 'wind');
    });

    test('eigene Geräusche des Spiels ersetzen eingebaute', () async {
      await Fx.instance.play(Sound.squelchOn, volume: 0.5);
      expect(deck.played, [('funk-knacken', 0.5)], reason: 'sound.ui.radio');
      await Fx.instance.play(Sound.solved);
      expect(deck.played, hasLength(1), reason: 'ohne eigene Aufnahme das eingebaute Geräusch');
      await s.solved(c.mediaFile(game.station('baum')!.sound.solved));
      expect(deck.played.last.$1, 'ast-knackt');
      s.detach();
      await Fx.instance.play(Sound.squelchOn);
      expect(deck.played, hasLength(2));
      expect(Fx.instance.custom, isNull);
    });

    test('Cue aus dem Spiel: spielt, duckt und taucht ohne Text nicht im Funk auf', () async {
      final heard = <ChatMessage>[];
      c.incoming.listen(heard.add);
      deck.hold = Completer<void>();
      server.pendingMessages.add({
        'kind': 'cue',
        'body': jsonEncode({'audio': 'eule', 'src': 'media/lib/eule.ogg', 'volume': 0.5}),
      });
      await c.sync();
      await wait(30);
      expect(heard.single.kind, 'cue');
      expect(heard.single.text, isEmpty);
      expect(deck.played, [('eule', 0.5)]);
      expect(Fx.instance.ducked, isTrue);
      expect(s.level, closeTo(0.35 * 0.8 * Soundscape.duckLevel, 1e-9));
      deck.hold!.complete();
      await wait(10);
      expect(Fx.instance.ducked, isFalse);
      expect(server.mediaRequests.where((p) => p.contains('eule')), hasLength(1), reason: 'Datei lag schon im Spielpaket');
    });

    test('Cue aus der Bibliothek wird einmal nachgeladen', () async {
      final cue = {'audio': 'lib:wolf-heulen', 'src': 'media/lib/wolf-heulen.ogg', 'volume': 0.9, 'text': 'Was war das?'};
      server.pendingMessages
        ..add({'kind': 'cue', 'body': jsonEncode(cue)})
        ..add({'kind': 'cue', 'body': jsonEncode(cue)});
      await c.sync();
      await wait(60);
      expect(deck.played, [('cue-lib-wolf-heulen.ogg', 0.9), ('cue-lib-wolf-heulen.ogg', 0.9)]);
      expect(server.mediaRequests.where((p) => p == '/lykora/media/lib/wolf-heulen.ogg'), hasLength(1), reason: 'zwei Cues, ein Download');
      expect(File('${c.store.mediaDir.path}/cue-lib-wolf-heulen.ogg').existsSync(), isTrue);
      server.mediaRequests.clear();
      expect(await c.cueFile(Cue.parse(jsonEncode(cue))!), isNotNull);
      expect(server.mediaRequests, isEmpty);
    });

    test('alte Cues nach einer Funkstille bleiben still', () async {
      server.pendingMessages.add({
        'kind': 'cue',
        'body': jsonEncode({'audio': 'eule'}),
        'created_at': DateTime.now().toUtc().subtract(const Duration(minutes: 10)).toIso8601String(),
      });
      await c.sync();
      await wait(30);
      expect(c.session!.messages.last.kind, 'cue');
      expect(deck.played, isEmpty);
    });

    test('Cue gibt die Atmosphäre immer frei: nach einem Fehler und wenn das Ende nie kommt', () async {
      deck.fail = true;
      await s.playCue(const Cue(audio: 'eule'));
      expect(Fx.instance.ducked, isFalse);
      deck
        ..fail = false
        ..hold = Completer<void>();
      final cue = s.playCue(const Cue(audio: 'eule'));
      await wait(30);
      expect(Fx.instance.ducked, isTrue);
      await cue;
      expect(Fx.instance.ducked, isFalse, reason: 'spätestens nach cueMaxLength');
      expect(s.level, closeTo(0.35 * 0.8, 1e-9));
    });

    test('Cue während eines Alarms beim Nachladen bleibt still', () async {
      final cue = s.playCue(const Cue(audio: 'lib:eule', src: 'media/lib/eule.ogg'));
      await Fx.instance.safetyAlarm();
      await cue;
      expect(deck.played, isEmpty);
      expect(Fx.instance.ducked, isFalse);
    });

    test('Cue ohne Datei und ohne Quelle spielt nichts', () async {
      await s.playCue(const Cue(audio: 'lib:gibt-es-nicht'));
      server.missingMedia.add('/lykora/media/lib/gibt-es-nicht.ogg');
      await s.playCue(const Cue(audio: 'lib:gibt-es-nicht', src: 'media/lib/gibt-es-nicht.ogg'));
      expect(deck.played, isEmpty);
      expect(Fx.instance.ducked, isFalse);
    });
  });

  group('Cue lesen', () {
    test('liest Klang, Quelle, Lautstärke und Funkspruch', () {
      final cue = Cue.parse(jsonEncode({'audio': 'lib:eule', 'src': 'media/lib/eule.ogg', 'volume': 0.4, 'text': '  Hört ihr das?  '}))!;
      expect(cue.audio, 'lib:eule');
      expect(cue.src, 'media/lib/eule.ogg');
      expect(cue.volume, 0.4);
      expect(cue.text, 'Hört ihr das?');
    });

    test('Standardwerte und Grenzen', () {
      final cue = Cue.parse('{"audio":"eule","volume":3,"text":"","src":""}')!;
      expect(cue.volume, 1);
      expect(cue.text, isNull);
      expect(cue.src, isNull);
      expect(Cue.parse('{"audio":"eule"}')!.volume, 0.8);
      expect(Cue.parse('{"audio":"eule","volume":"laut"}')!.volume, 0.8);
    });

    test('kaputte Cues', () {
      expect(Cue.parse('kein json'), isNull);
      expect(Cue.parse('[1]'), isNull);
      expect(Cue.parse('{"text":"ohne Klang"}'), isNull);
      expect(Cue.parse('{"audio":""}'), isNull);
    });

    test('Text im Funkprotokoll', () {
      ChatMessage msg(String kind, String body) => ChatMessage(direction: 'to_team', kind: kind, body: body, at: DateTime.now());
      expect(msg('cue', '{"audio":"eule","text":"Hört ihr das?"}').text, 'Hört ihr das?');
      expect(msg('cue', '{"audio":"eule"}').text, isEmpty);
      expect(msg('cue', 'kaputt').text, isEmpty);
      expect(msg('chat', '{"audio":"eule"}').text, '{"audio":"eule"}');
      expect(msg('chat', 'Weiter so!').cue, isNull);
    });

    test('Dateiname für nachgeladene Cues', () {
      expect(cueFileName('media/lib/eule.ogg'), 'cue-lib-eule.ogg');
      expect(cueFileName('media/0a1b2c.mp3'), 'cue-0a1b2c.mp3');
      expect(cueFileName('/media/0a1b2c.mp3'), 'cue-0a1b2c.mp3');
      expect(cueFileName('https://example.org/x/Ruf%20der%20Eule.ogg'), 'cue-example.org-x-Ruf_der_Eule.ogg');
      // Gleicher Name, andere Quelle: zwei Dateien
      expect(cueFileName('https://a.example.org/eule.ogg'), isNot(cueFileName('https://b.example.org/eule.ogg')));
      expect(cueFileName('../../session.json'), 'cue-session.json');
      final long = cueFileName('https://example.org/${'x' * 300}.ogg');
      expect(long.length, lessThanOrEqualTo(124));
      expect(long, endsWith('.ogg'));
    });
  });

  group('Vorlesen', () {
    late AppSettings prefs;

    /// Meldung der Vorlesestimme an die App, wie sie das Plugin schickt.
    Future<void> tts(String method) => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.handlePlatformMessage(
      'flutter_tts',
      const StandardMethodCodec().encodeMethodCall(MethodCall(method, true)),
      (_) {},
    );

    setUp(() async {
      prefs = AppSettings(SessionStore(await Directory.systemTemp.createTemp('lykora-tts-')));
    });

    tearDown(() {
      prefs.dispose();
      Fx.instance.safetyCleared();
    });

    test('duckt die Atmosphäre, solange die Stimme spricht, und gibt sie bei jedem Ende frei', () async {
      for (final end in ['speak.onComplete', 'speak.onCancel', 'speak.onError', 'speak.onPause']) {
        await tts('speak.onStart');
        expect(Fx.instance.ducked, isTrue);
        await tts(end);
        expect(Fx.instance.ducked, isFalse, reason: end);
      }
      await tts('speak.onStart');
      await prefs.stopSpeaking();
      expect(Fx.instance.ducked, isFalse, reason: 'Anhalten gibt frei, auch wenn die Stimme nichts meldet');
    });

    test('Sicherheitsalarm bricht das Vorlesen ab', () async {
      await tts('speak.onStart');
      expect(Fx.instance.ducked, isTrue);
      await Fx.instance.safetyAlarm();
      expect(Fx.instance.ducked, isFalse);
    });

    test('Lautstärke der Atmosphäre wird gespeichert und begrenzt', () async {
      await prefs.update(ambience: 0.4);
      final again = AppSettings(prefs.store);
      addTearDown(again.dispose);
      await again.load();
      expect(again.ambience, 0.4);
      expect(Soundscape.instance.volume, 0.4);
      await prefs.store.saveSettings({'ambience': 7});
      await again.load();
      expect(again.ambience, 1, reason: 'der Regler kennt nur 0 bis 1');
    });
  });

  group('Ausgabe über audioplayers', () {
    final messenger = TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    const channel = MethodChannel('xyz.luan/audioplayers');
    const global = MethodChannel('xyz.luan/audioplayers.global');
    const globalEvents = EventChannel('xyz.luan/audioplayers.global/events');

    /// Befehle an die Plattform je Spieler, ohne Abfragen der Position
    late Map<String, List<String>> calls;
    late Map<String, MockStreamHandlerEventSink> events;
    late File file;

    List<String> of(String id) => calls[id] ?? const [];

    /// Beginnt der Spieler zum Schluss zu spielen, oder ist er gestoppt?
    bool playing(String id) => of(id).where((m) => m == 'resume' || m == 'stop').lastOrNull == 'resume';

    setUp(() async {
      calls = {};
      events = {};
      file = File('${(await Directory.systemTemp.createTemp('lykora-deck-')).path}/wind.ogg')..writeAsBytesSync(const [0]);
      messenger
        ..setMockMethodCallHandler(global, (_) async => null)
        ..setMockStreamHandler(globalEvents, MockStreamHandler.inline(onListen: (_, _) {}))
        ..setMockMethodCallHandler(channel, (call) async {
          final id = (call.arguments as Map)['playerId'] as String;
          if (call.method != 'getCurrentPosition') (calls[id] ??= []).add(call.method);
          switch (call.method) {
            case 'create':
              messenger.setMockStreamHandler(
                EventChannel('xyz.luan/audioplayers/events/$id'),
                MockStreamHandler.inline(onListen: (_, sink) => events[id] = sink),
              );
            case 'setSourceUrl':
              // Eine Datei auf dem Gerät ist gleich bereit.
              scheduleMicrotask(() => events[id]?.success({'event': 'audio.onPrepared', 'value': true}));
          }
          return null;
        });
    });

    tearDown(() {
      messenger
        ..setMockMethodCallHandler(channel, null)
        ..setMockMethodCallHandler(global, null)
        ..setMockStreamHandler(globalEvents, null);
    });

    test('Anhalten, während die Schleife noch startet, hält sie wirklich an', () async {
      final deck = AudioDeck();
      unawaited(deck.loop(0, file, 0));
      await deck.stop(0);
      await wait(20);
      // Beide Spuren entstehen zusammen; gestartet wurde nur die erste.
      final track = calls.keys.firstWhere((id) => of(id).contains('setReleaseMode'));
      expect(of(track), containsAllInOrder(['setReleaseMode', 'resume', 'stop']));
      expect(playing(track), isFalse, reason: 'sonst liefe die Schleife unhörbar weiter und hielte das Handy wach');

      // Die Blende verstellt die Lautstärke, während die Spur startet: Es gilt die letzte.
      final volumes = <double>[];
      messenger.setMockMethodCallHandler(channel, (call) async {
        final args = call.arguments as Map;
        if (call.method == 'setVolume') volumes.add((args['volume'] as num).toDouble());
        if (call.method == 'setSourceUrl') scheduleMicrotask(() => events[args['playerId']]?.success({'event': 'audio.onPrepared', 'value': true}));
        return null;
      });
      unawaited(deck.loop(0, file, 0));
      await deck.volume(0, 0.3);
      await wait(20);
      expect(volumes.last, 0.3);
    });

    test('Hörstück, das beim Starten angehalten wird, bleibt still und duckt nicht', () async {
      Fx.enabled = true;
      addTearDown(() => Fx.enabled = false);
      final story = Fx.instance.playStory(file);
      await Fx.instance.stopStory();
      await story;
      await wait(20);
      final player = calls.keys.single;
      expect(of(player), contains('stop'));
      expect(playing(player), isFalse);
      expect(Fx.instance.ducked, isFalse);

      // Ohne Halt spielt es und duckt die Atmosphäre, bis es verklungen ist.
      await Fx.instance.playStory(file);
      await wait(20);
      expect(playing(player), isTrue);
      expect(Fx.instance.ducked, isTrue);
      events[player]!.success({'event': 'audio.onComplete'});
      await wait(20);
      expect(Fx.instance.ducked, isFalse);
    });

    test('Geräusche: freier Spieler zuerst, Abbruch greift auch beim Starten', () async {
      final deck = AudioDeck();
      final first = deck.once(file, 0.9);
      await wait(20);
      final a = calls.keys.single;
      expect(playing(a), isTrue);
      // Verklungen: Der nächste nutzt denselben Spieler, statt einen neuen anzulegen.
      events[a]!.success({'event': 'audio.onComplete'});
      await first;
      unawaited(deck.once(file, 0.9));
      await wait(20);
      expect(calls.keys, [a]);

      // Zweites Geräusch, während das erste läuft: eigener Spieler.
      unawaited(deck.once(file, 0.9));
      await wait(20);
      expect(calls.keys, hasLength(2));

      // Alarm, während ein drittes noch startet: Am Ende spielt keiner.
      final third = deck.once(file, 0.9);
      await deck.stopOnce();
      await third;
      await wait(20);
      expect(calls.keys, hasLength(3));
      for (final id in calls.keys) {
        expect(playing(id), isFalse, reason: id);
      }
    });
  });

  test('Modell: Klang im Spielformat mit Standardwerten', () {
    expect(game.sound.ambience!.volume, 0.35);
    expect(game.sound.ui('radio'), 'funk-knacken');
    expect(game.sound.ui('wrong'), isNull);
    expect(chapter3!.ambience!.audio, 'sturm');
    expect(game.chapter('kapitel-1')!.ambience, isNull);
    final baum = game.station('baum')!.sound;
    expect(baum.ambience!.from, 'near');
    expect(baum.approach('near'), 'eule');
    expect(baum.approach('mid'), isNull);
    expect(baum.solved, 'ast-knackt');
    expect(game.station('versteck')!.sound.ambience, isNull);
    expect(Ambience(const {'audio': 'x'}).volume, 0.6, reason: 'Standard laut Schema');
    expect(Ambience(const {'audio': 'x'}).from, 'near');
    final radio = game.stations.expand((s) => s.scene.all).firstWhere((b) => b.sfx != null);
    expect(radio.sfx, 'funk-knacken');
    final wind = game.media('wind')!;
    expect(wind.isAudio, isTrue);
    expect(wind.src, 'media/lib/wind.ogg');
    expect(wind.credit.resolve('de'), contains('CC0'));
    expect(game.mediaList.where((m) => m.isAudio), hasLength(9));
  });
}
