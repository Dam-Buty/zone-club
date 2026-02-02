const API_KEY = '6eaafd7bab593e5cb73121fedf19a390';

// Liste des IDs IMDB extraits du PDF
const imdbIds = [
  'tt0087803', 'tt0062622', 'tt0289043', 'tt0381849', 'tt0875113', 'tt0094625',
  'tt0144084', 'tt1024648', 'tt0093822', 'tt0120735', 'tt1517451', 'tt0250223',
  'tt0101410', 'tt0101507', 'tt0096895', 'tt0103776', 'tt0096543', 'tt0119177',
  'tt0083658', 'tt0185937', 'tt0103873', 'tt0252299', 'tt0071315', 'tt0103905',
  'tt0034583', 'tt0112641', 'tt0118843', 'tt1060277', 'tt0270288', 'tt1431045',
  'tt0112864', 'tt0099423', 'tt0095016', 'tt5700672', 'tt1853728', 'tt0119008',
  'tt0109686', 'tt0109707', 'tt0120663', 'tt0232500', 'tt0093058', 'tt0137523',
  'tt0113568', 'tt2267998', 'tt1205489', 'tt0462322', 'tt0347105', 'tt0212985',
  'tt0113277', 'tt0087843', 'tt0290673', 'tt0338564', 'tt0387808', 'tt0816692',
  'tt1588170', 'tt7286456', 'tt0120815', 'tt0266697', 'tt0373469', 'tt1250777',
  'tt0070047', 'tt0119488', 'tt0109440', 'tt0317248', 'tt0414993', 'tt0063442',
  'tt0118971', 'tt0120669', 'tt0060196', 'tt0119116', 'tt0102266', 'tt0993846',
  'tt1950186', 'tt0110413', 'tt0068646', 'tt0071562', 'tt0080455', 'tt1234548',
  'tt0120737', 'tt0167260', 'tt0167261', 'tt0102926', 'tt0460989', 'tt0482571',
  'tt0097223', 'tt0245429', 'tt0206634', 'tt3460252', 'tt0099685', 'tt0099582',
  'tt0106519', 'tt0449059', 'tt0072271', 'tt0022100', 'tt0166924', 'tt0116996',
  'tt0129387', 'tt1615147', 'tt0175880', 'tt0133093', 'tt1527186', 'tt0370986',
  'tt0117060', 'tt0079470', 'tt0353969', 'tt0364569', 'tt0089748', 'tt0071994',
  'tt6751668', 'tt0088763', 'tt0083944', 'tt0937237', 'tt0105236', 'tt0075148',
  'tt0093870', 'tt0086250', 'tt0208092', 'tt0365089', 'tt0158983', 'tt0387564',
  'tt0120201', 'tt0401792', 'tt0365737', 'tt0092005', 'tt0118715', 'tt0088247',
  'tt0103064', 'tt0100802', 'tt0108399', 'tt0468492', 'tt0116367', 'tt0107808',
  'tt0114814', 'tt0119217', 'tt2582802', 'tt0159097', 'tt0434409', 'tt0080339',
  'tt0095705', 'tt0196229', 'tt1230385'
];

async function convertImdbToTmdb(imdbId) {
  try {
    const res = await fetch(
      'https://api.themoviedb.org/3/find/' + imdbId + '?api_key=' + API_KEY + '&external_source=imdb_id'
    );
    const data = await res.json();
    if (data.movie_results && data.movie_results.length > 0) {
      return { imdbId, tmdbId: data.movie_results[0].id, title: data.movie_results[0].title };
    }
    return { imdbId, tmdbId: null, title: null };
  } catch (e) {
    return { imdbId, tmdbId: null, error: e.message };
  }
}

async function main() {
  const results = [];
  for (let i = 0; i < imdbIds.length; i++) {
    const result = await convertImdbToTmdb(imdbIds[i]);
    results.push(result);
    // Rate limiting
    await new Promise(r => setTimeout(r, 250));
    process.stderr.write('\r' + (i + 1) + '/' + imdbIds.length);
  }
  console.log('\n');

  const tmdbIds = results.filter(r => r.tmdbId).map(r => r.tmdbId);
  const failed = results.filter(r => !r.tmdbId);

  console.log('TMDB IDs trouvés:', tmdbIds.length);
  console.log('Échecs:', failed.length);
  if (failed.length > 0) {
    console.log('IDs non trouvés:', failed.map(f => f.imdbId).join(', '));
  }
  console.log('\nTMDB_IDS=' + JSON.stringify(tmdbIds));
}

main();
