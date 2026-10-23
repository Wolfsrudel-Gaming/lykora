// Klang und Vibration der App.
//
// Höchstens vier Vibrationsmuster, damit sie unterscheidbar bleiben: Tick, Puls, Ankunft und
// Sicherheit. Muster und Ton „Sicherheit“ sind reserviert und kommen in der Geschichte nie vor.
// Plugins fehlen in Widget-Tests; alle Aufrufe schlucken deshalb Fehler und lassen sich abschalten.
//
// Fx ist zugleich die Schaltstelle für die Klanglandschaft (soundscape.dart): Hier steht, ob gerade
// eine Stimme spricht (dann wird die Atmosphäre leiser) und ob ein Sicherheitsalarm läuft (dann
// schweigt alles). Wer darauf reagieren muss, hört als Listener zu.

import 'dart:async';
import 'dart:io';

import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:vibration/vibration.dart';

enum Sound { click, tick, squelchOn, squelchOff, pulse, arrival, solved, seal, rattle, key, chapter, hint, safety }

extension on Sound {
  String get file => switch (this) {
    Sound.squelchOn || Sound.hint => 'squelch_on',
    Sound.squelchOff => 'squelch_off',
    _ => name,
  };
}

/// Schlüssel in sound.ui des Spiels: Eine eigene Aufnahme dort ersetzt das eingebaute Geräusch.
const uiSoundKeys = {
  Sound.arrival: 'arrival',
  Sound.solved: 'solved',
  Sound.rattle: 'wrong',
  Sound.chapter: 'chapter',
  Sound.squelchOn: 'radio',
  Sound.hint: 'hint',
  Sound.key: 'key',
};

/// Mischt sich mit allem anderen, nimmt niemandem den Ton und läuft bei gesperrtem Bildschirm weiter.
final AudioContext mixAudio = AudioContextConfig(focus: AudioContextConfigFocus.mixWithOthers, stayAwake: true).build();

/// Stimme: Musik anderer Apps wird leiser; die eigene Atmosphäre duckt die Klanglandschaft selbst.
final AudioContext _voiceAudio = AudioContextConfig(focus: AudioContextConfigFocus.duckOthers, stayAwake: true).build();

/// Spieler ohne Positionsmeldung. Sonst fragt audioplayers bei jedem Bild die Position ab und erzwingt
/// neue Bilder, solange etwas spielt, bei einer Atmosphäre also stundenlang.
AudioPlayer newPlayer() => AudioPlayer()..positionUpdater = null;

enum Buzz {
  /// 10 ms leicht: Zahlenrad, Auswahl
  tick,

  /// 40 ms: Annäherung
  pulse,

  /// 80–60–80 ms: Station geweckt, gelöst
  arrival,

  /// 600–300–600–300–600 ms, volle Stärke: SOS, Rückruf, Sperrzone, Lebenszeichen
  safety,
}

class Fx extends ChangeNotifier {
  Fx._();
  static final instance = Fx._();

  /// In Widget-Tests aus, weil dort keine Plugins laufen.
  static bool enabled = !Platform.environment.containsKey('FLUTTER_TEST');

  bool _sound = true;

  /// Geräusche und Atmosphäre an; Hörstücke der Geschichte spielen immer.
  bool get sound => _sound;
  set sound(bool on) {
    if (on == _sound) return;
    _sound = on;
    notifyListeners();
  }

  bool vibration = true;

  /// Nur für Tests: meldet jede Vibration und jedes Geräusch, das die Schalter durchlässt, auch wenn Plugins fehlen.
  @visibleForTesting
  void Function(Buzz b)? onBuzz;
  @visibleForTesting
  void Function(Sound s)? onPlay;

  /// Spielt eine eigene Aufnahme des Spiels statt des eingebauten Geräuschs und gibt dann true zurück.
  /// Setzt die Klanglandschaft, solange ein Spiel geladen ist.
  bool Function(Sound sound, double volume)? custom;

  final _ui = <AudioPlayer>[];
  int _next = 0;
  AudioPlayer? _story;
  AudioPlayer? _safety;
  bool _safetyActive = false;
  final _voices = <Object>{};
  static const _storyVoice = #story;

  /// Zählt Start und Halt der Hörstücke, damit ein Halt mitten im Starten nicht verloren geht.
  int _storyRun = 0;

  /// Läuft gerade eine Sicherheitsdurchsage, schweigt die Geschichte.
  bool get safetyActive => _safetyActive;

  /// Spricht gerade eine Stimme (Hörstück, Vorlesen, Cue)? Dann ist die Atmosphäre leiser.
  bool get ducked => _voices.isNotEmpty;

  /// Eine Stimme setzt ein; [voice] kennzeichnet sie, bis [unduck] sie wieder abmeldet.
  void duck(Object voice) {
    if (_voices.add(voice)) notifyListeners();
  }

  void unduck(Object voice) {
    if (_voices.remove(voice)) notifyListeners();
  }

  AudioPlayer _uiPlayer() {
    if (_ui.length < 3) {
      final p = newPlayer()
        ..setPlayerMode(PlayerMode.lowLatency)
        ..setAudioContext(mixAudio);
      _ui.add(p);
      return p;
    }
    return _ui[_next++ % _ui.length];
  }

  Future<void> play(Sound s, {double volume = 0.8}) async {
    if (!sound || (_safetyActive && s != Sound.safety)) return;
    onPlay?.call(s);
    if (custom?.call(s, volume) ?? false) return;
    if (!enabled) return;
    try {
      await _uiPlayer().play(AssetSource('sounds/${s.file}.wav'), volume: volume);
    } catch (_) {}
  }

  Future<void> buzz(Buzz b) async {
    if (!vibration && b != Buzz.safety) return;
    onBuzz?.call(b);
    if (!enabled) return;
    try {
      switch (b) {
        case Buzz.tick:
          await HapticFeedback.selectionClick();
        case Buzz.pulse:
          await Vibration.vibrate(duration: 40, amplitude: 160);
        case Buzz.arrival:
          await Vibration.vibrate(pattern: const [0, 80, 60, 80], intensities: const [0, 200, 0, 200]);
        case Buzz.safety:
          await Vibration.vibrate(pattern: const [0, 600, 300, 600, 300, 600], intensities: const [0, 255, 0, 255, 0, 255]);
      }
    } catch (_) {}
  }

  AudioPlayer _storyPlayer() {
    final p = newPlayer();
    // Verklungen oder abgebrochen: Die Atmosphäre kommt wieder hoch.
    p.onPlayerComplete.listen((_) => unduck(_storyVoice), onError: (Object _) => unduck(_storyVoice));
    return p;
  }

  /// Hörstück der Geschichte aus dem Spielpaket. Ersetzt ein laufendes; die Atmosphäre duckt sich darunter.
  Future<void> playStory(File file, {void Function()? onDone}) async {
    if (!enabled || _safetyActive) return;
    final run = ++_storyRun;
    try {
      final p = _story ??= _storyPlayer();
      await p.stop();
      // Inzwischen angehalten (Alarm, SOS-Seite) oder von einem neueren Hörstück ersetzt. Ab play()
      // wirkt ein Halt von selbst: audioplayers startet dann nicht mehr.
      if (run != _storyRun || _safetyActive) return;
      if (onDone != null) unawaited(p.onPlayerComplete.first.then((_) => onDone()));
      duck(_storyVoice);
      await p.play(DeviceFileSource(file.path), ctx: _voiceAudio);
    } catch (_) {
      unduck(_storyVoice);
    }
  }

  Future<void> stopStory() async {
    _storyRun++;
    unduck(_storyVoice);
    try {
      await _story?.stop();
    } catch (_) {}
  }

  /// Sicherheitsfall: Geschichte, Atmosphäre und Cues sofort still, reservierter Zweiklang und Vibration.
  Future<void> safetyAlarm() async {
    if (!_safetyActive) {
      _safetyActive = true;
      // Klanglandschaft und Vorlesen hören zu und verstummen noch vor dem Alarmton.
      notifyListeners();
    }
    await stopStory();
    if (!enabled) return;
    try {
      final p = _safety ??= AudioPlayer();
      await p.play(AssetSource('sounds/${Sound.safety.file}.wav'), volume: 1);
    } catch (_) {}
    await buzz(Buzz.safety);
  }

  /// Lage geklärt: Die Atmosphäre setzt wieder ein.
  void safetyCleared() {
    if (!_safetyActive) return;
    _safetyActive = false;
    notifyListeners();
  }
}
