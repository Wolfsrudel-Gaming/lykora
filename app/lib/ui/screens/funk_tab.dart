import 'package:flutter/material.dart';

import '../../app.dart';
import '../../data/controller.dart';
import '../../model/game.dart';
import '../../services/fx.dart';
import '../design/components.dart';
import '../design/tokens.dart';
import '../story/beats.dart';

/// Ein Eintrag im Funkprotokoll.
class RadioEntry {
  RadioEntry({required this.sender, required this.text, required this.time, this.beat, this.pending = false, this.live = false, this.mine = false});
  final String sender;
  final String text;
  final DateTime time;
  final Beat? beat;
  final bool pending;
  final bool live;
  final bool mine;
}

/// Alles, was über Funk lief: Einsatzbefehl, Funksprüche der Stationen, Tipps, Meldungen beider Seiten.
List<RadioEntry> radioLog(BuildContext context, GameController c) {
  final game = c.game!;
  final s = c.session!;
  final st = c.state;
  final hq = game.hq?.name.of(context) ?? game.hqName.of(context);
  DateTime at(int ms) => DateTime.fromMillisecondsSinceEpoch(ms);
  final out = <RadioEntry>[];
  if (st.startedAt != null && !game.intro.isEmpty) out.add(RadioEntry(sender: hq, text: game.intro.of(context), time: at(st.startedAt!)));

  final triggeredAt = <String, int>{};
  final hintsAt = <String, List<int>>{};
  for (final a in s.actions) {
    final station = a.payload['station'] as String?;
    if (station == null) continue;
    if (a.type == 'trigger') triggeredAt.putIfAbsent(station, () => a.time);
    if (a.type == 'hint') hintsAt.putIfAbsent(station, () => []).add(a.time);
  }
  for (final station in game.stations) {
    String speaker(Beat b) => game.character(b.speaker)?.name.of(context) ?? hq;
    final trig = triggeredAt[station.id];
    if (trig != null && st.triggered.contains(station.id)) {
      for (final b in [...station.scene.arrival, ...station.scene.beats]) {
        if (b.kind == 'radio') out.add(RadioEntry(sender: speaker(b), text: b.text.of(context), time: at(trig), beat: b));
      }
    }
    final solved = st.solved[station.id];
    if (solved != null) {
      for (final b in station.scene.afterSolve) {
        if (b.kind == 'radio') out.add(RadioEntry(sender: speaker(b), text: b.text.of(context), time: at(solved), beat: b));
      }
    }
    final used = st.hints[station.id] ?? 0;
    final times = hintsAt[station.id] ?? const [];
    for (var i = 0; i < used && i < station.hints.length; i++) {
      out.add(RadioEntry(sender: 'Tipp', text: station.hints[i].text.of(context), time: at(i < times.length ? times[i] : (trig ?? c.now()))));
    }
  }
  final delivered = s.messages.where((m) => m.incoming).map((m) => m.body).toSet();
  for (final m in st.messages) {
    final text = m.text.of(context);
    if (!delivered.contains(text)) out.add(RadioEntry(sender: m.from == 'hq' ? hq : m.from, text: text, time: at(m.time)));
  }
  for (final m in s.messages) {
    // Ein Cue steht nur mit Funkspruch im Protokoll.
    if (m.kind == 'system' || (m.kind == 'cue' && m.text.isEmpty)) continue;
    final sender = !m.incoming
        ? 'Ihr'
        : (m.kind == 'hint' ? 'Tipp' : (m.sender == null || m.sender == 'hq' ? hq : (game.character(m.sender)?.name.of(context) ?? m.sender!)));
    // Live-Meldungen der Spielleitung in der Rolle der Zentrale; Regel-Nachrichten kommen als story.
    out.add(
      RadioEntry(
        sender: sender,
        text: m.text,
        time: m.at.toLocal(),
        pending: m.pending,
        live: m.incoming && (m.kind == 'chat' || m.kind == 'cue') && m.id != null,
        mine: !m.incoming,
      ),
    );
  }
  out.sort((a, b) => a.time.compareTo(b.time));
  return out;
}

/// Funk: Protokoll statt Chat-Blasen, Funktasten im 2×2-Raster.
class FunkTab extends StatefulWidget {
  const FunkTab({super.key});

  @override
  State<FunkTab> createState() => _FunkTabState();
}

class _FunkTabState extends State<FunkTab> {
  final _text = TextEditingController();
  bool _writing = false;

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  Future<void> _send(String body, {String kind = 'predefined'}) async {
    if (body.trim().isEmpty) return;
    final c = Lykora.game(context);
    Fx.instance.play(Sound.squelchOff);
    await c.sendMessage(body.trim(), kind: kind);
  }

  Future<void> _uneasy() async {
    final c = Lykora.game(context);
    await _send('Uns ist mulmig.');
    await c.addLocalRadio(
      'Alles gut, ihr seid nicht allein. Wir hören euch die ganze Zeit. Bleibt zusammen, macht eure Lampen an und geht in eurem Tempo weiter.',
    );
  }

  Future<void> _broken() async {
    final c = Lykora.game(context);
    final target = c.nextTarget;
    await _send(target == null ? 'Station kaputt? Wir kommen nicht weiter.' : 'Station kaputt? Wir kommen bei „${target.name.of(context)}“ nicht weiter.');
  }

  Future<void> _tip() async {
    final c = Lykora.game(context);
    final target = c.nextTarget;
    final name = target?.name.of(context);
    await _send('Wir brauchen einen Tipp.');
    if (target != null && c.state.triggered.contains(target.id) && target.hints.isNotEmpty) {
      await c.addLocalRadio('Verstanden. Öffnet die Station „$name“ und funkt dort „Tipp“.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = Lykora.game(context);
    return ListenableBuilder(
      listenable: c,
      builder: (context, _) {
        final t = context.tok;
        final log = radioLog(context, c).reversed.toList();
        final waiting = c.session!.messages.where((m) => m.pending).length;
        return Column(
          children: [
            if (waiting > 0)
              Container(
                width: double.infinity,
                color: t.p.surface,
                padding: const EdgeInsets.symmetric(horizontal: Space.gutter, vertical: 10),
                child: Text(
                  'Störung im Äther. $waiting ${waiting == 1 ? 'Meldung wird' : 'Meldungen werden'} gesendet, sobald Empfang da ist.',
                  style: t.small.copyWith(color: t.p.text),
                ),
              ),
            Expanded(
              child: log.isEmpty
                  ? Center(
                      child: Text('Noch Funkstille.\nDie Zentrale meldet sich hier.', textAlign: TextAlign.center, style: t.muted),
                    )
                  : ListView.separated(
                      reverse: true,
                      padding: const EdgeInsets.fromLTRB(Space.gutter, 12, Space.gutter, 12),
                      itemCount: log.length,
                      separatorBuilder: (_, _) => Divider(height: 24, color: t.p.line),
                      itemBuilder: (_, i) => _Entry(log[i]),
                    ),
            ),
            ActionZone(
              children: [
                if (_writing)
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: _text,
                          autofocus: true,
                          minLines: 1,
                          maxLines: 3,
                          textCapitalization: TextCapitalization.sentences,
                          style: t.body,
                          decoration: const InputDecoration(hintText: 'Meldung an die Zentrale'),
                        ),
                      ),
                      const SizedBox(width: 8),
                      SizedBox(
                        width: 64,
                        height: 64,
                        child: LKey(
                          label: '',
                          semanticLabel: 'Senden',
                          icon: Icons.send_rounded,
                          expand: false,
                          onPressed: () {
                            _send(_text.text, kind: 'chat');
                            _text.clear();
                            setState(() => _writing = false);
                          },
                        ),
                      ),
                    ],
                  )
                else ...[
                  Row(
                    children: [
                      Expanded(
                        child: _FunkKey(label: 'Verstanden', icon: Icons.check_rounded, onTap: () => _send('Verstanden.')),
                      ),
                      const SizedBox(width: Space.gap),
                      Expanded(
                        child: _FunkKey(label: 'Wir brauchen einen Tipp', icon: Icons.lightbulb_outline_rounded, onTap: _tip),
                      ),
                    ],
                  ),
                  Row(
                    children: [
                      Expanded(
                        child: _FunkKey(label: 'Uns ist mulmig', icon: Icons.nights_stay_rounded, onTap: _uneasy),
                      ),
                      const SizedBox(width: Space.gap),
                      Expanded(
                        child: _FunkKey(label: 'Station kaputt?', icon: Icons.build_circle_outlined, onTap: _broken),
                      ),
                    ],
                  ),
                  LKey(label: 'Schreiben', icon: Icons.edit_rounded, kind: KeyKind.tertiary, onPressed: () => setState(() => _writing = true)),
                ],
              ],
            ),
          ],
        );
      },
    );
  }
}

class _FunkKey extends StatelessWidget {
  const _FunkKey({required this.label, required this.icon, required this.onTap});
  final String label;
  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final t = context.tok;
    return Semantics(
      button: true,
      label: label,
      excludeSemantics: true,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: () {
          Fx.instance.play(Sound.click);
          onTap();
        },
        child: Container(
          height: Space.secondary,
          padding: const EdgeInsets.symmetric(horizontal: 12),
          decoration: BoxDecoration(
            color: t.p.surface,
            borderRadius: BorderRadius.circular(Space.radius),
            border: Border.all(color: t.p.accent, width: 2),
          ),
          child: Row(
            children: [
              Icon(icon, color: t.p.accent, size: 24),
              const SizedBox(width: 8),
              Expanded(
                child: Text(label, style: t.button.copyWith(fontSize: 16, color: t.p.text), maxLines: 2),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Entry extends StatelessWidget {
  const _Entry(this.e);
  final RadioEntry e;

  @override
  Widget build(BuildContext context) {
    final t = context.tok;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 104,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(e.sender.toUpperCase(), style: t.label.copyWith(color: e.mine ? t.p.textMuted : t.p.accent, fontSize: 13), maxLines: 2),
              const SizedBox(height: 2),
              Text(hhmm(e.time), style: t.label.copyWith(fontSize: 13, letterSpacing: 0.5)),
              if (e.live) ...[
                const SizedBox(height: 4),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                  decoration: BoxDecoration(
                    border: Border.all(color: t.p.accent),
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: Text('LIVE', style: t.label.copyWith(fontSize: 11, color: t.p.accent)),
                ),
              ],
            ],
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(e.text, style: t.body.copyWith(color: e.mine ? t.p.textMuted : t.p.text)),
              if (e.pending) Text('wartet auf Empfang', style: t.small),
              if (e.beat != null) ...[const SizedBox(height: 8), ReplayButton(onTap: () => voiceBeat(context, e.beat!, force: true))],
            ],
          ),
        ),
      ],
    );
  }
}
