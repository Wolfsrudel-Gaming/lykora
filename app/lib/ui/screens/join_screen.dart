import 'dart:async';

import 'package:app_links/app_links.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../app.dart';
import '../../data/api.dart';
import '../../services/fx.dart';
import '../design/components.dart';
import '../design/pictograms.dart';
import '../design/tokens.dart';
import '../widgets/common.dart';
import '../widgets/triggers.dart';

const defaultServer = 'https://riegel-troisdorf.de/lykora';

/// Einstieg: Event-Karte scannen oder Code eintippen. Die Laterne glimmt.
class JoinScreen extends StatefulWidget {
  const JoinScreen({super.key});

  @override
  State<JoinScreen> createState() => _JoinScreenState();
}

class _JoinScreenState extends State<JoinScreen> {
  final _code = TextEditingController();
  final _server = TextEditingController(text: defaultServer);
  bool _showServer = false;
  StreamSubscription<Uri>? _links;

  @override
  void initState() {
    super.initState();
    _code.addListener(() => setState(() {}));
    // Einstiegs-QR mit der Kamera-App gescannt: lykora://join?… öffnet die App direkt hier.
    try {
      _links = AppLinks().uriLinkStream.listen((uri) {
        final parsed = parseJoinCode(uri.toString());
        if (parsed == null || !mounted) return;
        if (parsed.server != null) _server.text = parsed.server!;
        _code.text = parsed.code;
        _continue();
      }, onError: (_) {});
    } catch (_) {}
  }

  @override
  void dispose() {
    _links?.cancel();
    _code.dispose();
    _server.dispose();
    super.dispose();
  }

  Future<void> _scan() async {
    final raw = await scanQr(context, title: 'Event-Karte scannen');
    if (raw == null || !mounted) return;
    final parsed = parseJoinCode(raw);
    if (parsed == null) {
      showMessage(context, 'Das ist keine Lykora-Karte.', error: true);
      return;
    }
    if (parsed.server != null) _server.text = parsed.server!;
    _code.text = parsed.code;
    _continue();
  }

  void _continue() {
    final parsed = parseJoinCode(_code.text);
    if (parsed == null) {
      showMessage(context, 'Bitte den Code von der Event-Karte eingeben.', error: true);
      return;
    }
    Navigator.of(context).push(
      FadeRoute<void>(
        builder: (_) => TeamSetupScreen(server: parsed.server ?? _server.text.trim(), code: parsed.code),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final t = context.tok;
    return Scaffold(
      backgroundColor: t.p.ground,
      body: Stack(
        children: [
          const Positioned.fill(child: NightGround()),
          SafeArea(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(Space.gutter + 4, 24, Space.gutter + 4, 24),
              children: [
                const Center(child: LanternMark(size: 130)),
                const SizedBox(height: 8),
                Text(
                  'Lykora',
                  textAlign: TextAlign.center,
                  style: t.display(56).copyWith(fontFamily: Fonts.brand, letterSpacing: 1),
                ),
                const SizedBox(height: 4),
                Text('Geschichten für draußen, bei Tag und bei Nacht', textAlign: TextAlign.center, style: t.muted),
                const SizedBox(height: 40),
                LKey(label: 'Event-Karte scannen', icon: Icons.qr_code_scanner_rounded, onPressed: _scan),
                const SizedBox(height: 28),
                Row(
                  children: [
                    Expanded(child: Container(height: 1, color: t.p.line)),
                    const Padding(padding: EdgeInsets.symmetric(horizontal: 12), child: Caps('oder Code eintippen')),
                    Expanded(child: Container(height: 1, color: t.p.line)),
                  ],
                ),
                const SizedBox(height: 16),
                CodeBoxes(controller: _code, onSubmitted: (_) => _continue()),
                const SizedBox(height: 16),
                LKey(label: 'Weiter', icon: Icons.arrow_forward_rounded, kind: KeyKind.secondary, onPressed: _code.text.length >= 4 ? _continue : null),
                const SizedBox(height: 24),
                LKey(label: 'Für Betreuer', kind: KeyKind.tertiary, onPressed: () => setState(() => _showServer = !_showServer)),
                if (_showServer) ...[
                  const SizedBox(height: 8),
                  TextField(
                    controller: _server,
                    keyboardType: TextInputType.url,
                    style: t.body,
                    decoration: const InputDecoration(labelText: 'Server-Adresse'),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Code in einzelnen Kästchen: Mono, automatisch Großbuchstaben.
class CodeBoxes extends StatefulWidget {
  const CodeBoxes({super.key, required this.controller, this.length = 6, this.onSubmitted, this.autofocus = false});
  final TextEditingController controller;
  final int length;
  final ValueChanged<String>? onSubmitted;
  final bool autofocus;

  @override
  State<CodeBoxes> createState() => _CodeBoxesState();
}

class _CodeBoxesState extends State<CodeBoxes> {
  final _focus = FocusNode();

  @override
  void initState() {
    super.initState();
    widget.controller.addListener(_changed);
    _focus.addListener(_changed);
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    widget.controller.removeListener(_changed);
    _focus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = context.tok;
    final text = widget.controller.text;
    return Stack(
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            for (var i = 0; i < widget.length; i++)
              Container(
                width: 48,
                height: 64,
                margin: const EdgeInsets.symmetric(horizontal: 3),
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: t.p.raised,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(
                    color: _focus.hasFocus && i == text.length.clamp(0, widget.length - 1) ? t.p.accent : t.p.edge,
                    width: _focus.hasFocus && i == text.length.clamp(0, widget.length - 1) ? 2.5 : 1.5,
                  ),
                ),
                child: Text(i < text.length ? text[i] : '', style: t.number.copyWith(fontSize: 32)),
              ),
          ],
        ),
        // Unsichtbares Eingabefeld über den Kästchen: Tastatur, Einfügen und Vorlesen funktionieren normal.
        Positioned.fill(
          child: Opacity(
            opacity: 0.01,
            child: TextField(
              controller: widget.controller,
              focusNode: _focus,
              autofocus: widget.autofocus,
              autocorrect: false,
              enableSuggestions: false,
              showCursor: false,
              maxLength: widget.length,
              textCapitalization: TextCapitalization.characters,
              inputFormatters: [
                FilteringTextInputFormatter.allow(RegExp('[A-Za-z0-9]')),
                TextInputFormatter.withFunction((_, v) => v.copyWith(text: v.text.toUpperCase())),
              ],
              decoration: const InputDecoration(counterText: '', border: InputBorder.none, filled: false),
              onSubmitted: widget.onSubmitted,
            ),
          ),
        ),
      ],
    );
  }
}

/// Team anlegen in drei Schritten oder ein weiteres Handy koppeln.
class TeamSetupScreen extends StatefulWidget {
  const TeamSetupScreen({super.key, required this.server, required this.code});
  final String server;
  final String code;

  @override
  State<TeamSetupScreen> createState() => _TeamSetupScreenState();
}

const _suggestions = ['Nachtfalken', 'Die Füchse', 'Eulenwacht', 'Team Glühwürmchen', 'Die Dachse', 'Mondläufer'];
const _colors = {
  'red': Color(0xFFE5533D),
  'blue': Color(0xFF4A90E2),
  'green': Color(0xFF3FA66B),
  'yellow': Color(0xFFF2C94C),
  'purple': Color(0xFF9B6BD3),
  'orange': Color(0xFFF2994A),
};
const _colorNames = {'red': 'Rot', 'blue': 'Blau', 'green': 'Grün', 'yellow': 'Gelb', 'purple': 'Lila', 'orange': 'Orange'};

class _TeamSetupScreenState extends State<TeamSetupScreen> {
  final _name = TextEditingController();
  final _phone = TextEditingController();
  final _pin = TextEditingController();
  final _deviceCode = TextEditingController();
  final _members = <TextEditingController>[TextEditingController()];
  String? _color;
  bool _existingTeam = false;
  bool _busy = false;
  int _step = 0;

  @override
  void initState() {
    super.initState();
    for (final c in [_name, _pin, _deviceCode]) {
      c.addListener(() => setState(() {}));
    }
  }

  @override
  void dispose() {
    for (final c in [_name, _phone, _pin, _deviceCode, ..._members]) {
      c.dispose();
    }
    super.dispose();
  }

  String? get _phoneError {
    final v = _phone.text.trim();
    return v.isEmpty || RegExp(r'^\+?[0-9 ()/-]{5,}$').hasMatch(v) ? null : 'Diese Nummer sieht nicht richtig aus.';
  }

  Future<void> _submit() async {
    setState(() => _busy = true);
    final c = Lykora.game(context);
    try {
      if (_existingTeam) {
        await c.join(server: widget.server, code: widget.code, deviceCode: _deviceCode.text.trim().toUpperCase());
      } else {
        await c.join(
          server: widget.server,
          code: widget.code,
          teamName: _name.text.trim(),
          color: _color,
          members: [
            for (final m in _members)
              if (m.text.trim().isNotEmpty) m.text.trim(),
          ],
          emergencyPhone: _phone.text.trim(),
          supervisorPin: _pin.text.trim(),
        );
      }
      Fx.instance.play(Sound.key);
      if (mounted) Navigator.of(context).popUntil((r) => r.isFirst);
    } on ApiException catch (e) {
      if (mounted) showMessage(context, e.offline ? 'Kein Netz. Für den Beitritt braucht ihr einmal Internet, z. B. am Treffpunkt.' : e.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _back() {
    if (_step > 0 && !_existingTeam) {
      setState(() => _step--);
    } else {
      Navigator.of(context).maybePop();
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = context.tok;
    final Widget body;
    final List<Widget> actions;
    if (_existingTeam) {
      body = _pair(t);
      actions = [
        LKey(
          label: 'Beitreten',
          icon: Icons.link_rounded,
          busy: _busy,
          onPressed: _deviceCode.text.trim().length >= 4 ? _submit : null,
          reason: 'Gerätecode eingeben',
        ),
      ];
    } else {
      switch (_step) {
        case 0:
          body = _nameStep(t);
          actions = [
            LKey(
              label: 'Weiter',
              icon: Icons.arrow_forward_rounded,
              onPressed: _name.text.trim().isEmpty ? null : () => setState(() => _step = 1),
              reason: 'Erst einen Namen wählen',
            ),
            LKey(label: 'Weiteres Handy für ein Team', kind: KeyKind.tertiary, onPressed: () => setState(() => _existingTeam = true)),
          ];
        case 1:
          body = _membersStep(t);
          actions = [
            LKey(
              label: 'Weiter',
              icon: Icons.arrow_forward_rounded,
              onPressed: _phoneError != null ? null : () => setState(() => _step = 2),
              reason: _phoneError,
            ),
          ];
        default:
          body = _supervisorStep(t);
          actions = [LKey(label: 'Verstanden – los geht’s', icon: Icons.flag_rounded, busy: _busy, onPressed: _submit)];
      }
    }
    return StageScaffold(
      title: _existingTeam ? 'Handy koppeln' : 'Event ${widget.code}',
      onBack: _existingTeam ? () => setState(() => _existingTeam = false) : _back,
      trailing: _existingTeam ? null : BeatDots(count: 3, index: _step),
      body: ListView(padding: const EdgeInsets.fromLTRB(Space.gutter, 8, Space.gutter, 24), children: [body]),
      actions: actions,
    );
  }

  Widget _nameStep(LykoraTokens t) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('Wie heißt euer Team?', style: t.display(30)),
        const SizedBox(height: 16),
        Wrap(
          spacing: 10,
          runSpacing: 10,
          children: [for (final s in _suggestions) _Choice(label: s, selected: _name.text == s, onTap: () => setState(() => _name.text = s))],
        ),
        const SizedBox(height: 18),
        TextField(
          controller: _name,
          style: t.body,
          textCapitalization: TextCapitalization.words,
          decoration: const InputDecoration(labelText: 'Teamname'),
        ),
        const SizedBox(height: 24),
        const Caps('Farbe eurer Laterne'),
        const SizedBox(height: 10),
        Wrap(
          spacing: 12,
          runSpacing: 12,
          children: [
            for (final e in _colors.entries)
              Semantics(
                button: true,
                selected: _color == e.key,
                label: _colorNames[e.key],
                excludeSemantics: true,
                child: GestureDetector(
                  onTap: () {
                    Fx.instance.buzz(Buzz.tick);
                    setState(() => _color = e.key);
                  },
                  child: Container(
                    width: 56,
                    height: 56,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: t.monochrome ? t.p.surface : e.value.withValues(alpha: 0.85),
                      border: Border.all(color: _color == e.key ? t.p.text : t.p.line, width: _color == e.key ? 4 : 1.5),
                    ),
                    alignment: Alignment.center,
                    child: _color == e.key
                        ? Icon(Icons.check_rounded, color: t.monochrome ? t.p.text : Colors.black87, size: 30)
                        : (t.monochrome ? Text(_colorNames[e.key]!.substring(0, 2), style: t.label.copyWith(color: t.p.text)) : null),
                  ),
                ),
              ),
          ],
        ),
      ],
    );
  }

  Widget _membersStep(LykoraTokens t) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('Wer ist dabei?', style: t.display(30)),
        const SizedBox(height: 6),
        Text('Nur Vornamen. Die Zentrale spricht euch damit an.', style: t.muted),
        const SizedBox(height: 16),
        for (final (i, m) in _members.indexed)
          Padding(
            padding: const EdgeInsets.only(bottom: Space.gap),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: m,
                    style: t.body,
                    textCapitalization: TextCapitalization.words,
                    decoration: InputDecoration(labelText: 'Vorname ${i + 1}'),
                  ),
                ),
                if (_members.length > 1)
                  IconButton(
                    tooltip: 'Entfernen',
                    constraints: const BoxConstraints(minWidth: 56, minHeight: 56),
                    icon: Icon(Icons.close_rounded, color: t.p.textMuted),
                    onPressed: () => setState(() => _members.removeAt(i).dispose()),
                  ),
              ],
            ),
          ),
        LKey(
          label: 'Person',
          icon: Icons.person_add_alt_rounded,
          kind: KeyKind.secondary,
          onPressed: () => setState(() => _members.add(TextEditingController())),
        ),
        const SizedBox(height: 28),
        const Caps('Notfall-Telefon'),
        const SizedBox(height: 6),
        Text('Eine Nummer, die während des Spiels erreichbar ist, z. B. ein Elternteil. Nur für Notfälle.', style: t.small),
        const SizedBox(height: 10),
        TextField(
          controller: _phone,
          keyboardType: TextInputType.phone,
          style: t.body,
          onChanged: (_) => setState(() {}),
          decoration: InputDecoration(labelText: 'Telefonnummer', errorText: _phoneError),
        ),
      ],
    );
  }

  Widget _supervisorStep(LykoraTokens t) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Icon(Icons.front_hand_rounded, size: 72, color: t.p.accent),
        const SizedBox(height: 12),
        Text('Gebt das Handy eurer Betreuerin oder eurem Betreuer.', style: t.display(26), textAlign: TextAlign.center),
        const SizedBox(height: 10),
        Text(
          'Mit der Betreuer-PIN der Spielleitung geht es los. Ihr könnt sie auch später vor dem Start eingeben.',
          style: t.muted,
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 20),
        CodeBoxes(controller: _pin),
        const SizedBox(height: 28),
        Panel(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(Icons.lock_outline_rounded, color: t.p.textMuted),
              const SizedBox(width: 12),
              Expanded(
                child: Text('Vornamen, Notfallnummer und Laufspur werden nur für dieses Spiel gespeichert und danach automatisch gelöscht.', style: t.small),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _pair(LykoraTokens t) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('Weiteres Handy für ein Team', style: t.display(28)),
        const SizedBox(height: 8),
        Text('Den Gerätecode zeigt das erste Handy unter Einstellungen.', style: t.muted),
        const SizedBox(height: 20),
        CodeBoxes(controller: _deviceCode, autofocus: true, onSubmitted: (_) => _submit()),
      ],
    );
  }
}

class _Choice extends StatelessWidget {
  const _Choice({required this.label, required this.selected, required this.onTap});
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final t = context.tok;
    return GestureDetector(
      onTap: () {
        Fx.instance.buzz(Buzz.tick);
        onTap();
      },
      child: AnimatedContainer(
        duration: Motion.tick,
        constraints: const BoxConstraints(minHeight: 56),
        padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
        decoration: BoxDecoration(
          color: selected ? t.p.raised : t.p.surface,
          borderRadius: BorderRadius.circular(Space.radius),
          border: Border.all(color: selected ? t.p.accent : t.p.edge, width: selected ? 2.5 : 1.5),
        ),
        child: Text(label, style: t.button.copyWith(fontSize: 18, color: t.p.text)),
      ),
    );
  }
}

/// Lichtmodus-Wahl mit Vorschaukacheln, z. B. in der Vorbereitung.
class LightChooser extends StatelessWidget {
  const LightChooser({super.key});

  @override
  Widget build(BuildContext context) {
    final prefs = Lykora.prefs(context);
    final t = context.tok;
    return ListenableBuilder(
      listenable: prefs,
      builder: (context, _) => Row(
        children: [
          for (final m in LightMode.values) ...[
            if (m != LightMode.values.first) const SizedBox(width: 8),
            Expanded(
              child: Semantics(
                button: true,
                selected: prefs.lightMode == m,
                label: 'Licht: ${m.label}',
                excludeSemantics: true,
                child: GestureDetector(
                  onTap: () {
                    Fx.instance.play(Sound.click);
                    prefs.update(lightMode: m);
                  },
                  child: Column(
                    children: [
                      Container(
                        height: 72,
                        decoration: BoxDecoration(
                          color: paletteFor(m, t.genre).ground,
                          borderRadius: BorderRadius.circular(Space.radius),
                          border: Border.all(color: prefs.lightMode == m ? t.p.accent : t.p.line, width: prefs.lightMode == m ? 3 : 1),
                        ),
                        alignment: Alignment.center,
                        child: Text(
                          'Aa',
                          style: TextStyle(fontFamily: Fonts.ui, fontSize: 26, fontWeight: FontWeight.w800, color: paletteFor(m, t.genre).accent),
                        ),
                      ),
                      const SizedBox(height: 6),
                      Text(m.label, style: t.small.copyWith(color: prefs.lightMode == m ? t.p.text : t.p.textMuted)),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
