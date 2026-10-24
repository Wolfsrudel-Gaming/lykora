// Sperrzonen mit Hysterese, Genauigkeit und Abklingzeit, dazu das Alter der Position.
//
// Die Sperrzone „Straße“ des Testspiels ist ein schmaler Streifen; seine Südkante liegt bei Länge 7,155
// auf Breite 50,8167. Ein Meter entspricht etwa 0,000009 Grad Breite.

import 'package:flutter_test/flutter_test.dart';
import 'package:lykora/data/controller.dart';
import 'package:lykora/engine/zones.dart';
import 'package:lykora/model/game.dart';

import 'support.dart';

const _southEdge = 50.8167;
const _lon = 7.155;

/// Punkt [m] Meter nördlich (in der Zone) oder südlich (davor, negativ) der Südkante.
GeoPoint at(double m) => GeoPoint(_southEdge + m * 0.000009, _lon);

void main() {
  final game = Game(gameJson);

  group('ZoneTracker', () {
    late ZoneTracker tracker;
    var t = 0;

    /// Ein Fix nach [seconds] Sekunden; liefert Anzeige und Alarme.
    ZoneUpdate fix(double m, {double accuracy = 10, int seconds = 5}) {
      t += seconds * 1000;
      return tracker.update(game, at(m), accuracy, t);
    }

    setUp(() {
      tracker = ZoneTracker();
      t = 100000;
    });

    test('Zonenrand mit Rauschen löst keinen Alarm aus', () {
      // Die Fixes springen alle 5 s um 4 m über die Kante, ein Fix innen, einer außen.
      final alarms = <String>[];
      for (var i = 0; i < 12; i++) {
        final u = fix(i.isEven ? 1 : -3, accuracy: 25);
        expect(u.alert?.inside ?? false, isFalse, reason: 'Fix $i');
        alarms.addAll(u.alarms);
      }
      expect(alarms.where((a) => a == 'zone_inside'), isEmpty);
      expect(alarms.where((a) => a == 'zone_near'), hasLength(1), reason: 'die Warnung vor der Zone kommt einmal');
    });

    test('Eintritt erst nach zwei Fixes in Folge, dann einmal Alarm', () {
      final first = fix(5);
      expect(first.alert!.inside, isFalse);
      expect(first.alarms, isNot(contains('zone_inside')));
      final second = fix(6);
      expect(second.alert!.inside, isTrue);
      expect(second.alert!.zone!.id, 'strasse');
      expect(second.alarms, ['zone_inside']);
      final third = fix(7);
      expect(third.alert!.inside, isTrue);
      expect(third.alarms, isEmpty, reason: 'ein Alarm je Eintritt');
    });

    test('Genauigkeit: ab 51 m kein Vollbild, nur „Ortung ungenau“', () {
      for (var i = 0; i < 5; i++) {
        final u = fix(8, accuracy: 51);
        expect(u.alert!.inside, isFalse);
        expect(u.alert!.uncertain, isTrue);
        expect(u.alert!.message, startsWith('Ortung ungenau'));
        expect(u.alarms, isNot(contains('zone_inside')));
      }
      // Genau 50 m zählt noch.
      tracker = ZoneTracker();
      fix(8, accuracy: 50);
      expect(fix(8, accuracy: 50).alert!.inside, isTrue);
    });

    test('ein ungenauer Fix unterbricht die Zählung', () {
      fix(5);
      expect(fix(5, accuracy: 90).alert!.inside, isFalse);
      expect(fix(5).alert!.inside, isFalse, reason: 'wieder bei eins');
      expect(fix(5).alert!.inside, isTrue);
    });

    test('ungenau und weit weg: keine Meldung', () {
      expect(fix(-200, accuracy: 90).alert, isNull);
    });

    test('Austritt erst ab 10 m Abstand', () {
      fix(5);
      fix(5);
      expect(fix(-3).alert!.inside, isTrue, reason: '3 m draußen sind Rauschen');
      expect(fix(5).alert!.inside, isTrue);
      final out = fix(-12);
      expect(out.alert!.inside, isFalse);
      expect(out.alert!.zone, isNotNull, reason: 'bleibt als Warnung vor der Zone, solange sie nah ist');
    });

    test('Austritt auch nach 10 s durchgehend draußen', () {
      fix(5);
      fix(5);
      expect(fix(-3).alert!.inside, isTrue);
      expect(fix(-3).alert!.inside, isTrue);
      expect(fix(-3).alert!.inside, isFalse, reason: 'seit 10 s außerhalb');
    });

    test('ein ungenauer Fix beweist den Austritt nicht', () {
      fix(5);
      fix(5);
      // 12 m draußen, aber der Fehlerkreis (90 m) reicht in die Zone.
      expect(fix(-12, accuracy: 90).alert!.inside, isTrue);
      // Weit draußen, über Fehlerkreis plus Spielraum.
      expect(fix(-120, accuracy: 90).alert, isNull);
    });

    test('Abklingzeit: dieselbe Zone alarmiert nicht noch einmal binnen 30 s', () {
      final alarms = <String>[];
      void run(List<double> path, {int seconds = 5}) {
        for (final m in path) {
          alarms.addAll(fix(m, seconds: seconds).alarms);
        }
      }

      run([5, 5]);
      expect(alarms.where((a) => a == 'zone_inside'), hasLength(1));
      run([-15, 5, 5]);
      expect(alarms.where((a) => a == 'zone_inside'), hasLength(1), reason: 'nach 15 s wieder drin, aber noch Abklingzeit');
      run([-15], seconds: 60);
      run([5, 5]);
      expect(alarms.where((a) => a == 'zone_inside'), hasLength(2), reason: 'nach über 30 s wieder ein Alarm');
    });

    test('Warnung vor der Zone: Eintritt bei 15 m, Austritt erst bei über 25 m', () {
      expect(fix(-30).alert, isNull);
      final near = fix(-14);
      expect(near.alert!.inside, isFalse);
      expect(near.alert!.message, startsWith('Achtung: Straße in'));
      expect(near.alarms, ['zone_near']);
      expect(fix(-20).alert, isNotNull, reason: 'Hysterese');
      expect(fix(-24).alert, isNotNull);
      expect(fix(-27).alert, isNull);
      // Wieder ran: noch in der Abklingzeit, also ohne neuen Ton.
      final again = fix(-14);
      expect(again.alert, isNotNull);
      expect(again.alarms, isEmpty);
    });

    test('Spielfeldgrenze: zwei Fixes draußen, Rückkehr erst nach 10 s drinnen', () {
      final out = GeoPoint(50.8155 + 0.0033, 7.155); // etwa 370 m nördlich der Mitte, Radius 300 m
      final inField = GeoPoint(50.8155, 7.155);
      ZoneUpdate step(GeoPoint p, {double accuracy = 10}) {
        t += 5000;
        return tracker.update(game, p, accuracy, t);
      }

      expect(step(out).alert, isNull);
      final second = step(out);
      expect(second.alert!.boundary, isTrue);
      expect(second.alert!.message, contains('Spielfeld'));
      expect(second.alarms, ['zone_near']);
      expect(step(inField).alert, isNotNull, reason: 'erst 0 s drinnen');
      expect(step(inField).alert, isNotNull, reason: 'erst 5 s drinnen');
      expect(step(inField).alert, isNull, reason: '10 s drinnen');
    });

    test('Spielfeldgrenze mit ungenauer Ortung: ein Fehlerkreis über der Kante zählt nicht', () {
      final nearEdge = GeoPoint(50.8155 + 0.00275, 7.155); // etwa 306 m, 6 m draußen
      for (var i = 0; i < 4; i++) {
        t += 5000;
        expect(tracker.update(game, nearEdge, 90, t).alert, isNull);
      }
    });

    test('Zone geht vor Spielfeldgrenze und blendet deren Alarm aus', () {
      // Die Zone liegt im Feld; wer drin steht, bekommt die Zone, nicht die Grenze.
      fix(5);
      final u = fix(5);
      expect(u.alert!.boundary, isFalse);
      expect(u.alarms, ['zone_inside']);
    });

    test('reset vergisst den Zustand', () {
      fix(5);
      fix(5);
      tracker.reset();
      expect(fix(5).alert!.inside, isFalse);
    });
  });

  group('Controller', () {
    late int clock;
    late FakeServer server;
    late GameController c;
    late List<String> alarms;

    DateTime wall(int ms) => DateTime.fromMillisecondsSinceEpoch(ms);

    setUp(() async {
      clock = DateTime.now().millisecondsSinceEpoch;
      server = FakeServer(now: () => wall(clock));
      c = await newController(server, backgroundLoops: false, clock: () => clock);
      alarms = [];
      c.onAlert = alarms.add;
      await c.start();
    });

    Future<void> fixAt(double m, {double accuracy = 10, int ageSeconds = 0}) =>
        c.onPosition(at(m).lat, at(m).lon, accuracy, at: wall(clock - ageSeconds * 1000));

    test('Zonenrand: sechs Fixes im Wechsel ergeben keinen Vollalarm', () async {
      for (var i = 0; i < 6; i++) {
        clock += 5000;
        await fixAt(i.isEven ? 1 : -3, accuracy: 25);
        expect(c.zoneAlert?.inside ?? false, isFalse);
      }
      expect(alarms, isNot(contains('zone_inside')));
    });

    test('Fix mit ±90 m innerhalb der Zone löst kein Vollbild aus', () async {
      for (var i = 0; i < 3; i++) {
        clock += 5000;
        await fixAt(8, accuracy: 90);
      }
      expect(c.zoneAlert!.inside, isFalse);
      expect(c.zoneAlert!.uncertain, isTrue);
      expect(c.zoneAlert!.message, contains('Ortung ungenau'));
      expect(alarms, isNot(contains('zone_inside')));
    });

    test('zwei sichere Fixes: Vollbild und ein Alarm', () async {
      clock += 5000;
      await fixAt(8);
      clock += 5000;
      await fixAt(8);
      expect(c.zoneAlert!.inside, isTrue);
      expect(alarms.where((a) => a == 'zone_inside'), hasLength(1));
    });

    test('ein veralteter Fix löst weder Zone noch Alarm aus', () async {
      await fixAt(8, ageSeconds: 60);
      await fixAt(8, ageSeconds: 60);
      expect(c.zoneAlert, isNull);
      expect(alarms, isEmpty);
    });

    test('ein Nachzügler überschreibt keine neuere Position', () async {
      await fixAt(-100);
      final newer = c.positionAt;
      clock += 10000;
      await c.onPosition(at(8).lat, at(8).lon, 10, at: wall(clock - 20000));
      expect(c.positionAt, newer, reason: 'der zweite Fix ist älter als der erste');
    });
  });

  group('Alter der Position', () {
    late int clock;
    late FakeServer server;
    late GameController c;

    DateTime wall(int ms) => DateTime.fromMillisecondsSinceEpoch(ms);

    setUp(() async {
      clock = DateTime.now().millisecondsSinceEpoch;
      server = FakeServer(now: () => wall(clock));
      c = await newController(server, backgroundLoops: false, clock: () => clock);
      await c.start();
    });

    test('ohne Fix: kein Alter, nicht frisch, nicht veraltet', () {
      expect(c.positionAge, isNull);
      expect(c.positionFresh, isFalse);
      expect(c.positionStale, isFalse);
    });

    test('frisch bis 20 s, danach veraltet', () async {
      await c.onPosition(50.8155, 7.155, 8, at: wall(clock));
      expect(c.positionAge, Duration.zero);
      expect(c.positionFresh, isTrue);
      clock += 20000;
      expect(c.positionAge, const Duration(seconds: 20));
      expect(c.positionFresh, isTrue);
      clock += 1000;
      expect(c.positionFresh, isFalse);
      expect(c.positionStale, isTrue);
      await c.onPosition(50.8155, 7.155, 8, at: wall(clock));
      expect(c.positionFresh, isTrue);
    });

    test('Aktionen tragen nur einen frischen Standort', () async {
      await c.onPosition(50.8155, 7.155, 8, at: wall(clock));
      await c.trigger('briefing', 'qr');
      expect(c.session!.actions.last.payload['location'], containsPair('accuracy', 8));
      clock += 60000;
      await c.answer('briefing', {
        'choice': [0],
      });
      expect(c.session!.actions.last.payload, isNot(contains('location')), reason: 'ein Standort von vor einer Minute ist nicht der jetzige');
    });

    test('ein alter Fix löst keine Station per GPS aus', () async {
      await c.onPosition(50.8156, 7.1552, 5, at: wall(clock - 120000));
      expect(c.state.triggered, isEmpty);
      await c.onPosition(50.8156, 7.1552, 5, at: wall(clock));
      expect(c.state.triggered, contains('briefing'));
    });

    test('Fehler des Ortungsstroms werden Zustand und verschwinden mit dem nächsten Fix', () async {
      expect(c.locationError, isNull);
      var notified = 0;
      c.addListener(() => notified++);
      c.onPositionError(StateError('aus'));
      expect(c.locationError, contains('Ortung'));
      expect(notified, 1);
      await c.onPosition(50.8155, 7.155, 8, at: wall(clock));
      expect(c.locationError, isNull);
    });
  });
}
