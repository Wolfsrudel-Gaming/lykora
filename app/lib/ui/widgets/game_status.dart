import 'package:flutter/material.dart';

import '../../app.dart';
import '../../data/controller.dart';
import '../design/components.dart';
import '../design/tokens.dart';
import '../screens/ende_screen.dart';

/// Wie es um das Spiel steht, wenn nicht einfach gespielt wird.
enum GameStatus {
  running,

  /// Die Spielleitung hat angehalten. Die Zeit steht.
  paused,

  /// Seit einer Weile kein Kontakt zur Spielleitung (Funkloch, Server weg).
  unreachable,

  /// Die Spielleitung hat das Spiel beendet.
  ended,
}

/// So lange ohne Abgleich gilt die Spielleitung als nicht erreichbar. Ein kurzes Funkloch im Wald ist normal.
const unreachableAfter = Duration(minutes: 2);

/// Beobachtet Pause, Ende und Erreichbarkeit der Spielleitung und meldet nur, wenn sich der Zustand ändert
/// (oder bei „nicht erreichbar“ eine volle Minute vergangen ist). Hängt sich an die Steuerung und die Uhr,
/// solange jemand zuhört.
class GameStatusWatch extends ChangeNotifier {
  GameStatusWatch._(this.c);

  static final _all = Expando<GameStatusWatch>();

  /// Ein Beobachter je Steuerung, für alle Bildschirme gleich.
  factory GameStatusWatch.of(GameController c) => _all[c] ??= GameStatusWatch._(c);

  final GameController c;
  GameStatus status = GameStatus.running;

  /// Minuten ohne Kontakt, solange [status] unreachable ist
  int silentMinutes = 0;

  /// Uhrzeit des Handys, seit der wir zuhören: Ohne Abgleich seit dem Start zählt erst ab hier.
  int? _since;

  @override
  void addListener(VoidCallback listener) {
    final first = !hasListeners;
    super.addListener(listener);
    if (first) _attach();
  }

  @override
  void removeListener(VoidCallback listener) {
    super.removeListener(listener);
    if (!hasListeners) _detach();
  }

  void _attach() {
    _since ??= _deviceNow();
    c.addListener(_check);
    c.clock.addListener(_check);
    _check();
  }

  void _detach() {
    c.removeListener(_check);
    c.clock.removeListener(_check);
  }

  int _deviceNow() => c.clock.value - (c.session?.clockOffsetMs ?? 0);

  /// Wie lange kein Abgleich geklappt hat; null mit Verbindung.
  Duration? silentFor() {
    if (c.online || c.session == null) return null;
    final last = c.session!.lastSyncAt?.millisecondsSinceEpoch ?? 0;
    final ref = last > (_since ?? 0) ? last : (_since ?? _deviceNow());
    final ms = _deviceNow() - ref;
    return Duration(milliseconds: ms < 0 ? 0 : ms);
  }

  void _check() {
    if (c.session == null || c.game == null) return;
    var next = GameStatus.running;
    var minutes = 0;
    if (c.eventEnded) {
      next = GameStatus.ended;
    } else if (c.paused) {
      next = GameStatus.paused;
    } else {
      final silent = silentFor();
      if (silent != null && silent >= unreachableAfter) {
        next = GameStatus.unreachable;
        minutes = silent.inMinutes;
      }
    }
    if (next == status && minutes == silentMinutes) return;
    status = next;
    silentMinutes = minutes;
    notifyListeners();
  }
}

/// Deutliche Karte unter dem Spielkopf bei Pause, Spielende und fehlendem Kontakt zur Spielleitung.
/// Im Ton der Spielwelt, nicht in Sicherheitsrot: Rot gehört dem Notfall.
class GameStatusBanner extends StatelessWidget {
  const GameStatusBanner({super.key});

  @override
  Widget build(BuildContext context) {
    final c = Lykora.game(context);
    final watch = GameStatusWatch.of(c);
    return ListenableBuilder(
      listenable: watch,
      builder: (context, _) {
        final status = watch.status;
        if (status == GameStatus.running) return const SizedBox.shrink();
        final t = context.tok;
        final waiting = c.unsyncedCount + c.sosQueueLength;
        final (IconData icon, String title, String text) = switch (status) {
          GameStatus.paused => (
            Icons.pause_circle_outline_rounded,
            'Pause',
            'Die Spielleitung hat das Spiel angehalten. Eure Zeit steht. Bleibt zusammen und wartet auf den Funk.',
          ),
          GameStatus.ended => (
            Icons.flag_circle_outlined,
            'Spiel beendet',
            'Die Spielleitung hat das Spiel beendet. Danke fürs Mitspielen! Hier ist euer Abschluss.',
          ),
          _ => (
            Icons.signal_wifi_connected_no_internet_4_rounded,
            'Spielleitung nicht erreichbar',
            'Seit ${watch.silentMinutes} Min. kein Kontakt. Das Spiel läuft auf eurem Handy weiter'
                '${waiting > 0 ? ' und $waiting ${waiting == 1 ? 'Meldung wartet' : 'Meldungen warten'} auf Empfang' : ''}. '
                'Im Notfall zählt SOS, auch ohne Netz per SMS.',
          ),
        };
        return Semantics(
          container: true,
          liveRegion: true,
          child: Container(
            width: double.infinity,
            margin: const EdgeInsets.fromLTRB(Space.gutter, 10, Space.gutter, 0),
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: t.p.surface,
              borderRadius: BorderRadius.circular(Space.radius),
              border: Border.all(color: t.p.accent, width: 2),
            ),
            // Bei großer Schrift darf die Karte nicht das ganze Spiel verdrängen: höchstens knapp ein Drittel, der Rest scrollt.
            child: ConstrainedBox(
              constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * 0.3),
              child: SingleChildScrollView(
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(icon, color: t.p.accentBright, size: 32),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(title, style: t.body.copyWith(fontWeight: FontWeight.w700)),
                          const SizedBox(height: 2),
                          Text(text, style: t.small.copyWith(color: t.p.text)),
                          if (status == GameStatus.ended) ...[
                            const SizedBox(height: 8),
                            LKey(label: 'Zum Abschluss', icon: Icons.flag_rounded, kind: KeyKind.secondary, onPressed: () => openEnde(context)),
                          ],
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}
