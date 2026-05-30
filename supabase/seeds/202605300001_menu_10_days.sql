begin;

delete from public.jedalny_listok
where datum between '2026-05-30' and '2026-06-08';

insert into public.jedalny_listok
  (datum, typ_jedla, varianta, nazov, popis, poradie, aktivne)
values
  ('2026-05-30', 'OBED', 'MASO', 'Kuracie soté s ryžou', 'Kuracie mäso na zelenine, dusená ryža', 1, true),
  ('2026-05-30', 'OBED', 'VEGE', 'Zeleninové rizoto', 'Ryža, zelenina, syr', 2, true),
  ('2026-05-30', 'OBED', 'DIETA', 'Kuracie mäso s ryžou', 'Kuracie mäso na prírodno, dusená ryža', 3, true),
  ('2026-05-30', 'VECERA', 'MASO', 'Šunkové cestoviny', 'Cestoviny so šunkou a syrom', 1, true),
  ('2026-05-30', 'VECERA', 'VEGE', 'Cestoviny so syrovou omáčkou', 'Cestoviny, jemná syrová omáčka', 2, true),
  ('2026-05-30', 'VECERA', 'DIETA', 'Cestoviny s tvarohom', 'Cestoviny, jemný tvaroh', 3, true),

  ('2026-05-31', 'OBED', 'MASO', 'Bravčové karé so zemiakmi', 'Bravčové karé, varené zemiaky, šalát', 1, true),
  ('2026-05-31', 'OBED', 'VEGE', 'Zapekané zemiaky so zeleninou', 'Zemiaky, zelenina, syr', 2, true),
  ('2026-05-31', 'OBED', 'DIETA', 'Morčacie mäso so zemiakmi', 'Morčacie mäso na prírodno, varené zemiaky', 3, true),
  ('2026-05-31', 'VECERA', 'MASO', 'Kurací wrap', 'Tortilla, kuracie mäso, zelenina', 1, true),
  ('2026-05-31', 'VECERA', 'VEGE', 'Zeleninový wrap', 'Tortilla, zelenina, syr', 2, true),
  ('2026-05-31', 'VECERA', 'DIETA', 'Ryžový šalát s kuracím mäsom', 'Ryža, kuracie mäso, zelenina', 3, true),

  ('2026-06-01', 'OBED', 'MASO', 'Hovädzí guláš s knedľou', 'Hovädzie mäso, omáčka, knedľa', 1, true),
  ('2026-06-01', 'OBED', 'VEGE', 'Šošovicový prívarok s vajíčkom', 'Šošovica, vajíčko, chlieb', 2, true),
  ('2026-06-01', 'OBED', 'DIETA', 'Dusené hovädzie s ryžou', 'Hovädzie mäso na prírodno, dusená ryža', 3, true),
  ('2026-06-01', 'VECERA', 'MASO', 'Pečené kuracie stehno', 'Kuracie stehno, zemiaková kaša', 1, true),
  ('2026-06-01', 'VECERA', 'VEGE', 'Brokolicové fašírky', 'Brokolicové fašírky, zemiaková kaša', 2, true),
  ('2026-06-01', 'VECERA', 'DIETA', 'Kuracie prsia so zemiakovou kašou', 'Kuracie prsia na prírodno, zemiaková kaša', 3, true),

  ('2026-06-02', 'OBED', 'MASO', 'Kurací paprikáš s cestovinou', 'Kuracie mäso, jemná omáčka, cestovina', 1, true),
  ('2026-06-02', 'OBED', 'VEGE', 'Cícerové kari s ryžou', 'Cícer, zelenina, ryža', 2, true),
  ('2026-06-02', 'OBED', 'DIETA', 'Kuracie prsia s cestovinou', 'Kuracie prsia na prírodno, cestovina', 3, true),
  ('2026-06-02', 'VECERA', 'MASO', 'Francúzske zemiaky', 'Zemiaky, vajíčko, klobása', 1, true),
  ('2026-06-02', 'VECERA', 'VEGE', 'Zeleninové lasagne', 'Cestoviny, zelenina, syr', 2, true),
  ('2026-06-02', 'VECERA', 'DIETA', 'Zapekané zemiaky s tvarohom', 'Zemiaky, jemný tvaroh', 3, true),

  ('2026-06-03', 'OBED', 'MASO', 'Bravčové soté s tarhoňou', 'Bravčové mäso na zelenine, tarhoňa', 1, true),
  ('2026-06-03', 'OBED', 'VEGE', 'Hubové rizoto', 'Ryža, šampiňóny, syr', 2, true),
  ('2026-06-03', 'OBED', 'DIETA', 'Morčacie soté s tarhoňou', 'Morčacie mäso na prírodno, tarhoňa', 3, true),
  ('2026-06-03', 'VECERA', 'MASO', 'Špagety bolognese', 'Cestoviny, hovädzie mäso, paradajková omáčka', 1, true),
  ('2026-06-03', 'VECERA', 'VEGE', 'Špagety pomodoro', 'Cestoviny, paradajková omáčka, syr', 2, true),
  ('2026-06-03', 'VECERA', 'DIETA', 'Cestoviny s kuracím mäsom', 'Cestoviny, kuracie mäso na prírodno', 3, true),

  ('2026-06-04', 'OBED', 'MASO', 'Pečené kura s ryžou', 'Kuracie mäso, dusená ryža, kompót', 1, true),
  ('2026-06-04', 'OBED', 'VEGE', 'Vyprážaný syr so zemiakmi', 'Syr, varené zemiaky, šalát', 2, true),
  ('2026-06-04', 'OBED', 'DIETA', 'Kuracie prsia s ryžou', 'Kuracie prsia na prírodno, dusená ryža', 3, true),
  ('2026-06-04', 'VECERA', 'MASO', 'Fazuľová polievka s údeným mäsom', 'Fazuľa, údené mäso, chlieb', 1, true),
  ('2026-06-04', 'VECERA', 'VEGE', 'Paradajkové rizoto', 'Ryža, paradajky, syr', 2, true),
  ('2026-06-04', 'VECERA', 'DIETA', 'Zeleninová polievka s cestovinou', 'Zelenina, jemný vývar, cestovina', 3, true),

  ('2026-06-05', 'OBED', 'MASO', 'Segedínsky guláš s knedľou', 'Bravčové mäso, kapusta, knedľa', 1, true),
  ('2026-06-05', 'OBED', 'VEGE', 'Karfiolový nákyp', 'Karfiol, zemiaky, syr', 2, true),
  ('2026-06-05', 'OBED', 'DIETA', 'Dusené bravčové so zemiakmi', 'Bravčové mäso na prírodno, varené zemiaky', 3, true),
  ('2026-06-05', 'VECERA', 'MASO', 'Kuracie nugetky so zemiakmi', 'Kuracie nugetky, pečené zemiaky', 1, true),
  ('2026-06-05', 'VECERA', 'VEGE', 'Grilovaná zelenina s kuskusom', 'Zelenina, kuskus, syr', 2, true),
  ('2026-06-05', 'VECERA', 'DIETA', 'Morčacie mäso s kuskusom', 'Morčacie mäso na prírodno, kuskus', 3, true),

  ('2026-06-06', 'OBED', 'MASO', 'Morčací rezeň so zemiakovou kašou', 'Morčacie mäso, zemiaková kaša, šalát', 1, true),
  ('2026-06-06', 'OBED', 'VEGE', 'Tekvicový prívarok s vajíčkom', 'Tekvica, vajíčko, zemiaky', 2, true),
  ('2026-06-06', 'OBED', 'DIETA', 'Morčacie mäso so zemiakovou kašou', 'Morčacie mäso na prírodno, zemiaková kaša', 3, true),
  ('2026-06-06', 'VECERA', 'MASO', 'Šunková pizza', 'Pizza so šunkou a syrom', 1, true),
  ('2026-06-06', 'VECERA', 'VEGE', 'Zeleninová pizza', 'Pizza so zeleninou a syrom', 2, true),
  ('2026-06-06', 'VECERA', 'DIETA', 'Ryža s dusenou zeleninou', 'Dusená ryža, jemne upravená zelenina', 3, true),

  ('2026-06-07', 'OBED', 'MASO', 'Bravčový perkelt s haluškami', 'Bravčové mäso, omáčka, halušky', 1, true),
  ('2026-06-07', 'OBED', 'VEGE', 'Bryndzové halušky', 'Halušky, bryndza', 2, true),
  ('2026-06-07', 'OBED', 'DIETA', 'Kuracie mäso s varenými zemiakmi', 'Kuracie mäso na prírodno, varené zemiaky', 3, true),
  ('2026-06-07', 'VECERA', 'MASO', 'Mäsové guľky s ryžou', 'Mäsové guľky, paradajková omáčka, ryža', 1, true),
  ('2026-06-07', 'VECERA', 'VEGE', 'Zeleninové guľky s ryžou', 'Zeleninové guľky, paradajková omáčka, ryža', 2, true),
  ('2026-06-07', 'VECERA', 'DIETA', 'Ryža s morčacím mäsom', 'Dusená ryža, morčacie mäso na prírodno', 3, true),

  ('2026-06-08', 'OBED', 'MASO', 'Kurací steak s bulgurom', 'Kuracie mäso, bulgur, zelenina', 1, true),
  ('2026-06-08', 'OBED', 'VEGE', 'Bulgur so zeleninou a tofu', 'Bulgur, zelenina, tofu', 2, true),
  ('2026-06-08', 'OBED', 'DIETA', 'Kuracie mäso s bulgurom', 'Kuracie mäso na prírodno, bulgur', 3, true),
  ('2026-06-08', 'VECERA', 'MASO', 'Zapečené cestoviny s mäsom', 'Cestoviny, mleté mäso, syr', 1, true),
  ('2026-06-08', 'VECERA', 'VEGE', 'Zapečené cestoviny so zeleninou', 'Cestoviny, zelenina, syr', 2, true),
  ('2026-06-08', 'VECERA', 'DIETA', 'Cestoviny s dusenou zeleninou', 'Cestoviny, jemne upravená zelenina', 3, true);

commit;
