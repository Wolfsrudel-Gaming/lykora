import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';

import 'app.dart';
import 'data/controller.dart';
import 'data/session.dart';
import 'services/soundscape.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final dir = await getApplicationSupportDirectory();
  final store = SessionStore(dir);
  final controller = GameController(store: store);
  await controller.load();
  Soundscape.instance.attach(controller);
  final settings = AppSettings(store);
  await settings.load();
  runApp(LykoraApp(controller: controller, settings: settings));
}
