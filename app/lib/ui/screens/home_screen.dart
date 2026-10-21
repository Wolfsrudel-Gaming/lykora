import 'dart:async';

import 'package:battery_plus/battery_plus.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../app.dart';
import '../../data/session.dart';
import '../../services/location.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'backpack_tab.dart';
import 'chat_tab.dart';
import 'emergency_screen.dart';
import 'leaderboard_screen.dart';
import 'map_tab.dart';
import 'settings_screen.dart';
import 'stations_tab.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int _tab = 0;
  Timer? _battery;
  int _unread = 0;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _setup());
  }

  Future<void> _setup() async {
    final c = Lykora.game(context);
    c.startLoops();
    c.onIncomingMessage = _onMessage;
    c.onAlert = _onAlert;
    if (await LocationService.instance.ensurePermission() == null) {
      await LocationService.instance.start((p) => c.onPosition(p.latitude, p.longitude, p.accuracy, at: p.timestamp));
    }
    Future<void> readBattery() async {
      try {
        c.battery = (await Battery().batteryLevel) / 100;
      } catch (_) {}
    }

    await readBattery();
    _battery = Timer.periodic(const Duration(minutes: 2), (_) => readBattery());
  }

  @override
  void dispose() {
    _battery?.cancel();
    super.dispose();
  }

  void _onMessage(ChatMessage m) {
    if (!mounted) return;
    HapticFeedback.heavyImpact();
    if (_tab != 3) setState(() => _unread++);
    final prefs = Lykora.prefs(context);
    if (prefs.readAloud) prefs.speak(m.body);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('${m.kind == 'hint' ? 'Hinweis' : (m.sender == 'hq' || m.sender == null ? 'Zentrale' : m.sender)}: ${m.body}'),
        action: SnackBarAction(label: 'Öffnen', onPressed: () => setState(() => _tab = 3)),
      ),
    );
  }

  Future<void> _onAlert(String kind) async {
    // Kräftig vibrieren, damit es auch in der Tasche auffällt.
    for (var i = 0; i < (kind == 'recall' || kind == 'zone_inside' ? 5 : 2); i++) {
      await HapticFeedback.vibrate();
      await Future<void>.delayed(const Duration(milliseconds: 400));
    }
    if (kind == 'recall' && mounted) {
      final prefs = Lykora.prefs(context);
      prefs.speak('Achtung. Alle zurück zum Sammelpunkt.');
    }
  }

  Future<void> _confirmHeartbeat() async {
    await Lykora.game(context).heartbeat();
    if (mounted) showMessage(context, 'Danke! Lebenszeichen gesendet.');
  }

  @override
  Widget build(BuildContext context) {
    final c = Lykora.game(context);
    return ListenableBuilder(
      listenable: c,
      builder: (context, _) {
        final remaining = c.remaining;
        return Scaffold(
          appBar: AppBar(
            titleSpacing: 12,
            title: Row(
              children: [
                if (remaining != null) ...[
                  Icon(Icons.timer_outlined, size: 20, color: remaining < 600 ? sosRed : null),
                  const SizedBox(width: 4),
                  Text(
                    formatDuration(remaining),
                    style: TextStyle(fontFeatures: const [FontFeature.tabularFigures()], color: remaining < 600 ? sosRed : null),
                  ),
                  const SizedBox(width: 14),
                ],
                const Icon(Icons.star_outline, size: 20),
                const SizedBox(width: 4),
                Text('${c.state.points}'),
              ],
            ),
            actions: [
              _SyncIcon(online: c.online, syncing: c.syncing, pending: c.unsyncedCount),
              PopupMenuButton<String>(
                onSelected: (v) {
                  final page = switch (v) {
                    'leaderboard' => const LeaderboardScreen(),
                    'emergency' => const EmergencyScreen(),
                    _ => const SettingsScreen(),
                  };
                  Navigator.of(context).push(MaterialPageRoute(builder: (_) => page));
                },
                itemBuilder: (_) => const [
                  PopupMenuItem(value: 'leaderboard', child: Text('Rangliste')),
                  PopupMenuItem(value: 'emergency', child: Text('Notfallinfos')),
                  PopupMenuItem(value: 'settings', child: Text('Einstellungen')),
                ],
              ),
              const SosButton(),
            ],
          ),
          body: Column(
            children: [
              if (c.recalled)
                AlertStrip(
                  icon: Icons.campaign,
                  color: sosRed,
                  text: 'ALLE ZURÜCK zum Sammelpunkt: ${c.game!.field.assemblyPoint.name.of(context)}',
                  action: 'Karte',
                  onAction: () => setState(() => _tab = 0),
                ),
              if (c.zoneAlert != null)
                AlertStrip(icon: Icons.do_not_step, color: c.zoneAlert!.inside ? sosRed : Colors.orange.shade800, text: c.zoneAlert!.message),
              if (c.paused) const AlertStrip(icon: Icons.pause_circle_outline, color: Colors.blueGrey, text: 'Das Spiel ist pausiert.'),
              if (c.sosPending)
                AlertStrip(
                  icon: Icons.sms_failed_outlined,
                  color: sosRed,
                  text: 'SOS wird gesendet, sobald Netz da ist.',
                  action: 'Details',
                  onAction: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const EmergencyScreen())),
                ),
              if (c.heartbeatDue)
                AlertStrip(
                  icon: Icons.favorite_outline,
                  color: Colors.teal.shade700,
                  text: 'Alles in Ordnung bei euch?',
                  action: 'Ja, alles ok',
                  onAction: _confirmHeartbeat,
                ),
              if (c.finished)
                AlertStrip(
                  icon: Icons.emoji_events_outlined,
                  color: okGreen,
                  text: 'Geschafft! Kommt zum Treffpunkt.',
                  action: 'Rangliste',
                  onAction: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const LeaderboardScreen())),
                ),
              Expanded(
                child: IndexedStack(index: _tab, children: const [MapTab(), StationsTab(), BackpackTab(), ChatTab()]),
              ),
            ],
          ),
          bottomNavigationBar: NavigationBar(
            selectedIndex: _tab,
            onDestinationSelected: (i) => setState(() {
              _tab = i;
              if (i == 3) _unread = 0;
            }),
            destinations: [
              const NavigationDestination(icon: Icon(Icons.map_outlined), selectedIcon: Icon(Icons.map), label: 'Karte'),
              NavigationDestination(
                icon: Badge(
                  label: Text('${c.visibleStations.where((s) => !c.state.solved.containsKey(s.id)).length}'),
                  child: const Icon(Icons.place_outlined),
                ),
                label: 'Stationen',
              ),
              const NavigationDestination(icon: Icon(Icons.backpack_outlined), selectedIcon: Icon(Icons.backpack), label: 'Rucksack'),
              NavigationDestination(
                icon: Badge(isLabelVisible: _unread > 0, label: Text('$_unread'), child: const Icon(Icons.forum_outlined)),
                label: 'Zentrale',
              ),
            ],
          ),
        );
      },
    );
  }
}

class _SyncIcon extends StatelessWidget {
  const _SyncIcon({required this.online, required this.syncing, required this.pending});
  final bool online;
  final bool syncing;
  final int pending;

  @override
  Widget build(BuildContext context) {
    final text = online
        ? (pending == 0 ? 'Verbunden, alles übertragen' : 'Verbunden, $pending Aktionen werden übertragen')
        : 'Kein Netz – das Spiel läuft weiter. $pending Aktionen warten.';
    return IconButton(
      tooltip: text,
      onPressed: () {
        showMessage(context, text);
        Lykora.game(context).sync();
      },
      icon: Badge(
        isLabelVisible: pending > 0,
        label: Text('$pending'),
        child: Icon(syncing ? Icons.sync : (online ? Icons.cloud_done_outlined : Icons.cloud_off_outlined)),
      ),
    );
  }
}
