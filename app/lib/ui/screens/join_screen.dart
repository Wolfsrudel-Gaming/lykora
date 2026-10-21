import 'dart:async';

import 'package:app_links/app_links.dart';
import 'package:flutter/material.dart';

import '../../app.dart';
import '../../data/api.dart';
import '../widgets/common.dart';

const defaultServer = 'https://riegel-troisdorf.de/lykora';

/// Einstieg: Event-QR scannen oder Code eingeben, dann Team anlegen oder einem Team beitreten.
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
    // Einstiegs-QR mit der Kamera-App gescannt: lykora://join?… öffnet die App direkt hier.
    _links = AppLinks().uriLinkStream.listen((uri) {
      final parsed = parseJoinCode(uri.toString());
      if (parsed == null || !mounted) return;
      if (parsed.server != null) _server.text = parsed.server!;
      _code.text = parsed.code;
      _continue();
    }, onError: (_) {});
  }

  @override
  void dispose() {
    _links?.cancel();
    _code.dispose();
    _server.dispose();
    super.dispose();
  }

  Future<void> _scan() async {
    final raw = await scanQr(context, title: 'Event-QR scannen');
    if (raw == null || !mounted) return;
    final parsed = parseJoinCode(raw);
    if (parsed == null) {
      showMessage(context, 'Das ist kein Lykora-Code.', error: true);
      return;
    }
    if (parsed.server != null) _server.text = parsed.server!;
    _code.text = parsed.code;
    _continue();
  }

  void _continue() {
    final parsed = parseJoinCode(_code.text);
    if (parsed == null) {
      showMessage(context, 'Bitte einen gültigen Event-Code eingeben.', error: true);
      return;
    }
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => TeamSetupScreen(server: parsed.server ?? _server.text.trim(), code: parsed.code),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(24),
          children: [
            const SizedBox(height: 32),
            Icon(Icons.light_outlined, size: 72, color: theme.colorScheme.primary),
            const SizedBox(height: 12),
            Text(
              'Lykora',
              textAlign: TextAlign.center,
              style: theme.textTheme.displaySmall?.copyWith(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 8),
            Text('Outdoor-Abenteuer für Teams', textAlign: TextAlign.center, style: theme.textTheme.titleMedium),
            const SizedBox(height: 40),
            FilledButton.icon(onPressed: _scan, icon: const Icon(Icons.qr_code_scanner), label: const Text('Event-QR scannen')),
            const SizedBox(height: 24),
            Text('oder Code eingeben', textAlign: TextAlign.center, style: theme.textTheme.bodySmall),
            const SizedBox(height: 8),
            TextField(
              controller: _code,
              textCapitalization: TextCapitalization.characters,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 24, letterSpacing: 4),
              decoration: const InputDecoration(hintText: 'K7M2QX'),
              onSubmitted: (_) => _continue(),
            ),
            const SizedBox(height: 12),
            OutlinedButton(onPressed: _continue, child: const Text('Weiter')),
            const SizedBox(height: 24),
            TextButton(onPressed: () => setState(() => _showServer = !_showServer), child: const Text('Anderer Server')),
            if (_showServer)
              TextField(
                controller: _server,
                keyboardType: TextInputType.url,
                decoration: const InputDecoration(labelText: 'Server-Adresse'),
              ),
          ],
        ),
      ),
    );
  }
}

/// Team anlegen (Name, Mitglieder, Notfallnummer, Betreuer-PIN) oder weiteres Handy koppeln.
class TeamSetupScreen extends StatefulWidget {
  const TeamSetupScreen({super.key, required this.server, required this.code});
  final String server;
  final String code;

  @override
  State<TeamSetupScreen> createState() => _TeamSetupScreenState();
}

class _TeamSetupScreenState extends State<TeamSetupScreen> {
  static const colors = {'Rot': 'red', 'Blau': 'blue', 'Grün': 'green', 'Gelb': 'yellow', 'Lila': 'purple', 'Orange': 'orange'};
  final _form = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _phone = TextEditingController();
  final _pin = TextEditingController();
  final _deviceCode = TextEditingController();
  final _members = <_MemberRow>[_MemberRow()];
  String? _color;
  bool _consent = false;
  bool _existingTeam = false;
  bool _busy = false;

  @override
  void dispose() {
    for (final c in [_name, _phone, _pin, _deviceCode]) {
      c.dispose();
    }
    for (final m in _members) {
      m.name.dispose();
    }
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_existingTeam && !_form.currentState!.validate()) return;
    if (!_existingTeam && !_consent) {
      showMessage(context, 'Bitte die Hinweise zum Datenschutz bestätigen.', error: true);
      return;
    }
    setState(() => _busy = true);
    final c = Lykora.game(context);
    try {
      if (_existingTeam) {
        await c.join(server: widget.server, code: widget.code, deviceCode: _deviceCode.text.trim().toUpperCase());
      } else {
        final rows = _members.where((m) => m.name.text.trim().isNotEmpty).toList();
        await c.join(
          server: widget.server,
          code: widget.code,
          teamName: _name.text.trim(),
          color: _color,
          members: rows.map((m) => m.name.text.trim()).toList(),
          emergencyPhone: _phone.text.trim(),
          supervisorPin: _pin.text.trim(),
        );
      }
      if (mounted) Navigator.of(context).popUntil((r) => r.isFirst);
    } on ApiException catch (e) {
      if (mounted) showMessage(context, e.offline ? 'Kein Netz. Für den Beitritt braucht ihr einmal Internet, z. B. am Treffpunkt.' : e.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text('Event ${widget.code}')),
      body: Form(
        key: _form,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            SegmentedButton<bool>(
              segments: const [
                ButtonSegment(value: false, label: Text('Neues Team'), icon: Icon(Icons.group_add_outlined)),
                ButtonSegment(value: true, label: Text('Team beitreten'), icon: Icon(Icons.phonelink_ring_outlined)),
              ],
              selected: {_existingTeam},
              onSelectionChanged: (v) => setState(() => _existingTeam = v.first),
            ),
            const SizedBox(height: 16),
            if (_existingTeam) ...[
              const Text('Weiteres Handy für ein bestehendes Team. Den Gerätecode zeigt das erste Handy unter Einstellungen.'),
              const SizedBox(height: 12),
              TextField(
                controller: _deviceCode,
                textCapitalization: TextCapitalization.characters,
                decoration: const InputDecoration(labelText: 'Gerätecode des Teams'),
              ),
            ] else ...[
              TextFormField(
                controller: _name,
                decoration: const InputDecoration(labelText: 'Teamname'),
                validator: (v) => (v ?? '').trim().isEmpty ? 'Bitte einen Namen eingeben' : null,
              ),
              const SizedBox(height: 12),
              Wrap(
                spacing: 8,
                children: [
                  for (final e in colors.entries)
                    ChoiceChip(label: Text(e.key), selected: _color == e.value, onSelected: (_) => setState(() => _color = e.value)),
                ],
              ),
              const SizedBox(height: 20),
              Text('Mitglieder (nur Vornamen)', style: Theme.of(context).textTheme.titleMedium),
              for (final row in _members)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: row.name,
                          decoration: const InputDecoration(labelText: 'Vorname'),
                        ),
                      ),
                      if (_members.length > 1) IconButton(icon: const Icon(Icons.remove_circle_outline), onPressed: () => setState(() => _members.remove(row))),
                    ],
                  ),
                ),
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton.icon(onPressed: () => setState(() => _members.add(_MemberRow())), icon: const Icon(Icons.add), label: const Text('Mitglied')),
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _phone,
                keyboardType: TextInputType.phone,
                decoration: const InputDecoration(labelText: 'Notfall-Telefonnummer', helperText: 'Erreichbar während des Spiels, z. B. ein Elternteil'),
                validator: (v) => (v ?? '').trim().isEmpty || RegExp(r'^\+?[0-9 ()/-]{5,}$').hasMatch(v!.trim()) ? null : 'Ungültige Nummer',
              ),
              const SizedBox(height: 20),
              Text('Betreuer', style: Theme.of(context).textTheme.titleMedium),
              const Text('Bei Kindern und Jugendlichen startet das Spiel erst mit Betreuer. Die PIN bekommt der Betreuer von der Spielleitung.'),
              const SizedBox(height: 8),
              TextField(
                controller: _pin,
                textCapitalization: TextCapitalization.characters,
                decoration: const InputDecoration(labelText: 'Betreuer-PIN'),
              ),
              const SizedBox(height: 16),
              CheckboxListTile(
                value: _consent,
                onChanged: (v) => setState(() => _consent = v ?? false),
                contentPadding: EdgeInsets.zero,
                title: const Text('Vornamen, Notfallnummer und Laufspur werden nur für dieses Spiel gespeichert und danach automatisch gelöscht.'),
              ),
            ],
            const SizedBox(height: 16),
            FilledButton(
              onPressed: _busy ? null : _submit,
              child: _busy ? const SizedBox(height: 22, width: 22, child: CircularProgressIndicator(strokeWidth: 2)) : const Text('Los'),
            ),
          ],
        ),
      ),
    );
  }
}

class _MemberRow {
  final name = TextEditingController();
}
