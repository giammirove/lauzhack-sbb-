import fetch from "node-fetch"
import fs from "fs"
import { Temporal } from "@js-temporal/polyfill";

const API_URL = "https://journey-service-int.api.sbb.ch";
const CLIENT_SECRET = "MU48Q~IuD6Iawz3QfvkmMiKHtfXBf-ffKoKTJdt5";
const CLIENT_ID = "f132a280-1571-4137-86d7-201641098ce8";
const SCOPE = "c11fa6b1-edab-4554-a43d-8ab71b016325/.default";


const MAX_INT = Number.POSITIVE_INFINITY;

const API_KEY_JOURNEY_MAPS = "bf9e3a88ab8101ba22ba8c752bbbcfd8";

const POST = "POST";
const GET = "GET";

const FT_RANGE = 1;
const PR_RANGE = 1;
const KM_RANGE = 10;

const OSM_TYPE_CAR = "car";
const OSM_TYPE_FOOT = "foot";
const SBB_MODE_TRAIN = "TRAIN";
const SBB_MODE_FOOT = "FOOT";

// min time to turn on the car and fine a sport in the parking lot
const MIN_TIME_CAR = 5;


function l(...s) {
  console.log(...s);
}

function read_db() {
  return JSON.parse(fs.readFileSync("mobilitat.json"));
}

function norm_coords(pos) {
  return { lon: pos.longitude, lat: pos.latitude };
}

function gen_coords(lat, lon) {
  return { longitude: lon, latitude: lat };
}

function get_hours_and_minutes(date) {
  let d = new Date(date);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

function pretty_print_trip(trip, start) {
  let legs = trip.legs;
  let s = "=====================TRIP====================\n";
  let t = "";
  for (let leg of legs) {
    let start_time = leg.mode === SBB_MODE_FOOT ? leg.start.timeAimed : leg?.serviceJourney?.stopPoints[0].departure.timeAimed;
    let end_time = leg.mode === SBB_MODE_FOOT ? leg.end.timeAimed : leg?.serviceJourney?.stopPoints[leg?.serviceJourney?.stopPoints?.length - 1].arrival.timeAimed;
    let duration = (Temporal.Duration.from(leg.duration)).total({ unit: "minutes" });
    t += `  ${leg.mode.toString().padEnd(6, " ")} (${duration.toString().padStart(4, " ")}) [${get_hours_and_minutes(start_time)} -> ${get_hours_and_minutes(end_time)}]\n`;
  }
  t += `DONE\n`;
  s += `Trip : ${calc_trip_duration(trip, start)} minutes\n` + t;
  s += "=============================================";
  l(s);
}

function pretty_print_place(place) {
  let s = "====================PLACE====================\n";

  s += `\tName : ${place.name}\n\tCoords : ${place.centroid.coordinates[1]},${place.centroid.coordinates[0]}`;
  s += '\n';

  s += "=============================================";
  l(s);
}

function pretty_print_pr(pr) {
  let s = "=====================P+R=====================\n";

  s += `\tName : ${pr.bezeichnung_offiziell}\n\tCoords : ${pr.geopos.lat},${pr.geopos.lon}`;
  s += '\n';

  s += "=============================================";
  l(s);
}


function calc_distance(pos1, pos2) {
  return Math.sqrt(Math.pow(Math.abs(pos1.lat - pos2.lat), 2) + Math.pow(Math.abs(pos1.lon - pos2.lon), 2)) * 111;
}
function coord_in_range(pos1, pos2, range) {
  return calc_distance(pos1, pos2) <= range;
}

function filter_db(data, filter) {
  let d = []
  for (let i = 0; i < data.length; i++) {
    if (coord_in_range(data[i].geopos, filter.geopos, filter.geopos.range)) {
      d.push(data[i]);
    }
  }
  return d;
}

async function get_token() {
  const params = {
    'grant_type': 'client_credentials',
    'scope': SCOPE,
    'client_id': CLIENT_ID,
    'client_secret': CLIENT_SECRET
  }
  let res = await fetch('https://login.microsoftonline.com/2cda5d11-f0ac-46b3-967d-af1b2e1bd01a/oauth2/v2.0/token', {
    headers: {
      'Accept-Language': 'en',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams(params),
    method: "POST"
  })
  let data = await res.json();
  return data;
}

async function get_headers(api_key) {
  let token = (await get_token()).access_token;
  return {
    'Authorization': `Bearer ${token}`,
    'X-API-Key': api_key,
    'Content-Type': 'application/json'
  };
}

function jsonToQueryString(json) {
  return '?' +
    Object.keys(json).map(function(key) {
      return encodeURIComponent(key) + '=' +
        encodeURIComponent(json[key]);
    }).join('&');
}


async function get_journey_service(route, method, data) {
  let url = `https://journey-service-int.api.sbb.ch${route}`
  const headers = await get_headers(API_KEY_JOURNEY_MAPS);
  let body;
  if (method == "GET") {
    url += jsonToQueryString(data);
  } else {
    body = JSON.stringify(data);
  }
  let res = await fetch(url, {
    headers: headers,
    body: body,
    method: method
  })

  return (await res.json());
}

// return distance in meters
async function get_open_street_map_directions(start_coords, dest_coords, type) {
  let s_coords = `${start_coords.lon},${start_coords.lat}`;
  let d_coords = `${dest_coords.lon},${dest_coords.lat}`;

  let url = `https://routing.openstreetmap.de/routed-${type}/route/v1/driving/${s_coords};${d_coords}`;
  let res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/118.0',
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'Accept-Language': 'en-US,en;q=0.5',
      'Accept-Encoding': 'gzip, deflate, br',
      'Referer': 'https://www.openstreetmap.org/',
      'Origin': 'https://www.openstreetmap.org',
      'Connection': 'keep-alive',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'cross-site'
    }
  });
  let data = await res.json();
  // in meters
  let distance_meters = data.routes[0].distance;
  // in minutes 
  let travel_time = data.routes[0].duration / 60;

  return { distance_meters, travel_time };
}


async function get_stops_that_reach_location(origin_coords, dest_coords, date, time, walk_speed) {
  let origin_coords_req = `[${origin_coords.lon},${origin_coords.lat}]`;
  let dest_coords_req = `[${dest_coords.lon},${dest_coords.lat}]`;
  let stops = [];
  try {
    let trips = (await get_journey_service('/v3/trips/by-origin-destination', POST, { "origin": origin_coords_req, "destination": dest_coords_req, "date": date, "time": time, "mobilityFilter": { "walkSpeed": walk_speed, }, "includeAccessibility": "ALL", })).trips;
    let ids = [];

    for (let t of trips) {
      // l(t);
      if (t.status.reachable !== true || t.duration === undefined)
        continue;
      for (let leg of t.legs) {
        if (leg.mode !== SBB_MODE_FOOT) {
          if (!ids.includes(leg.serviceJourney.stopPoints[0].place.id)) {
            stops.push(leg.serviceJourney.stopPoints[0].place);
            ids.push(leg.serviceJourney.stopPoints[0].place.id);
          }
          break;
        }
      }
    }
  } catch (e) {
  }
  return stops;
}

// consider also pauses
function calc_trip_duration(trip, start) {
  let legs = trip.legs;
  let s = start || null;
  let e = null;
  for (let leg of legs) {
    let start_time = leg.mode === SBB_MODE_FOOT ? leg.start.timeAimed : leg?.serviceJourney?.stopPoints[0].departure.timeAimed;
    let end_time = leg.mode === SBB_MODE_FOOT ? leg.end.timeAimed : leg?.serviceJourney?.stopPoints[leg?.serviceJourney?.stopPoints?.length - 1].arrival.timeAimed;
    if (s == null)
      s = start_time;
    e = end_time;
  }
  let d = new Date(e) - new Date(s);
  return parseInt((d) / 60000);
}

async function get_fastest_trip(origin_coords, dest_coords, date, time, walk_speed) {
  let place_dest_trip_min = undefined;
  let place_dest_trips;
  let origin_coords_req = `[${origin_coords.lon},${origin_coords.lat}]`;
  let dest_coords_req = `[${dest_coords.lon},${dest_coords.lat}]`;
  try {
    // seems to return results in a sorted manner (optimization ?)
    // TODO: destionation could be just coordinates [lon,lat]
    place_dest_trips = await get_journey_service('/v3/trips/by-origin-destination', POST, { "origin": origin_coords_req, "destination": dest_coords_req, "date": date, "time": time, "mobilityFilter": { "walkSpeed": walk_speed, }, includeVehicleModes: true, "includeAccessibility": "ALL", });

    let travel_time_trip_min = MAX_INT;
    for (let trip of place_dest_trips.trips) {
      // when duration is null it means that the trip is not rideable
      // [[TripResponse]]
      if (trip.duration === undefined)
        continue;
      let travel_time_trip = (Temporal.Duration.from(trip.duration)).total({ unit: "minutes" });
      // let travel_time_trip = calc_trip_duration(trip);
      if (travel_time_trip < travel_time_trip_min) {
        travel_time_trip_min = travel_time_trip;
        place_dest_trip_min = trip;
      }
    }

    place_dest_trip_min.duration = travel_time_trip_min;
  } catch (e) {
    // l(place_dest_trips)
    // l(origin_coords_req, dest_coords_req, date, time, walk_speed);
    // throw new Error(`Error in get_fastest_trip : ` + e);
  }

  return place_dest_trip_min;
}


async function get_fastest_trip_by_place(place, pr_coords_norm, user_dest_coords_norm, user_date, user_time, user_walk_speed) {
  let place_coords = { lon: place.centroid.coordinates[0], lat: place.centroid.coordinates[1] };
  let directions_place = await get_open_street_map_directions(place_coords, pr_coords_norm, OSM_TYPE_FOOT);
  let travel_time_place = directions_place.travel_time;

  let trip = await get_fastest_trip(place_coords, user_dest_coords_norm, user_date, user_time, user_walk_speed);
  if (trip === undefined)
    return undefined;
  trip.duration += travel_time_place;
  return { trip, place };
}

async function get_fastest_trip_by_pr(pr, user_start_coords, user_dest_coords_norm, user_date, user_time, user_walk_speed) {
  let pr_coords = { longitude: pr.geopos.lon, latitude: pr.geopos.lat };
  let pr_coords_norm = norm_coords(pr_coords);
  let directions_pr = await get_open_street_map_directions(user_start_coords, pr_coords_norm, OSM_TYPE_CAR);
  let travel_time_start_pr = directions_pr.travel_time;

  let stop_places = await get_stops_that_reach_location(pr_coords_norm, user_dest_coords_norm, user_date, user_time, user_walk_speed);

  let promises_trips = [];
  for (const place of stop_places) {
    promises_trips.push(get_fastest_trip_by_place(place, pr_coords_norm, user_dest_coords_norm, user_date, user_time, user_walk_speed));
  }
  let results = await Promise.all(promises_trips);
  let travel_time_user_dest_min = MAX_INT;
  let travel_time_start_pr_min = MAX_INT;
  let trip_min = null;
  let place_min = null;
  for (let r of results) {
    if (!r)
      continue;

    let travel_time_pr = MIN_TIME_CAR + travel_time_start_pr + r.trip.duration;

    if (travel_time_pr < travel_time_user_dest_min) {
      travel_time_user_dest_min = travel_time_pr;
      trip_min = r.trip;
      place_min = r.place;
      travel_time_start_pr_min = travel_time_start_pr;

      // pretty_print_pr(pr);
      // l(`Time to go to P+R by car : ${travel_time_start_pr} minutes`);
      // pretty_print_place(r.place);
      // pretty_print_trip(r.trip);
      // l(travel_time_pr, travel_time_start_pr, r.trip.duration);
      // l('\n');
    }
  }

  if (trip_min == null)
    return undefined;

  return { travel_time: travel_time_user_dest_min, travel_time_to_pr: travel_time_start_pr_min, trip: trip_min, place: place_min, pr };
}


async function test() {
  const user_date = "2023-11-30";
  const user_time = "13:37";
  const user_datetime = new Date(2023, 10, 30, 13, 37, 0, 0);
  const user_walk_speed = 50;
  const user_start_coords = norm_coords(gen_coords(46.52958149822397, 6.6511232175885615));
  const user_dest_coords = gen_coords(46.19727861915838, 6.1369142672764925);
  const user_dest_coords_norm = norm_coords(user_dest_coords);

  const db = read_db();

  l(`Going out at ${user_time}`);

  let travel_time_user_dest_min = MAX_INT;
  let travel_time_to_pr_min = MAX_INT;
  let pr_min = null;
  let place_min = null;
  let trip_min = null;

  // db contains duplicates :(
  let near_prs = filter_db(db, { geopos: { range: KM_RANGE, ...user_start_coords } });

  let naive_trip = await get_fastest_trip(user_start_coords, user_dest_coords_norm, user_date, user_time, user_walk_speed);
  pretty_print_trip(naive_trip, user_datetime);
  l('');

  let promises = [];
  for (const pr of near_prs) {
    promises.push(get_fastest_trip_by_pr(pr, user_start_coords, user_dest_coords_norm, user_date, user_time, user_walk_speed));
  }
  let results = await Promise.all(promises);
  for (let r of results) {
    if (!r)
      continue;

    if (r.trip.duration < travel_time_user_dest_min) {
      travel_time_user_dest_min = r.travel_time;
      pr_min = r.pr;
      place_min = r.place;
      trip_min = r.trip;
      travel_time_to_pr_min = r.travel_time_to_pr;
    }
  }
  if (pr_min != null) {
    pretty_print_pr(pr_min);
    pretty_print_place(place_min);
    pretty_print_trip(trip_min);
    l(`Time to go to P+R by car : ${travel_time_to_pr_min} minutes`);
    l(`Calculated time with P+R : ${travel_time_user_dest_min} minutes`);
  }
}

test();


async function test2() {
  let res = await fetch('https://journey-maps.api.sbb.ch/v1/route?fromStationID=8503000&toStationID=8507000&api_key=bf9e3a88ab8101ba22ba8c752bbbcfd8');
}

// test2();
