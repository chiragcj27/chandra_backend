const {JobCard} = require('../../models/jobCard');
const {StageDefinition} = require('../../models/stageDefinition');
const {Cell} = require('../../models/cell');
const {ProductionCalendar} = require('../../models/productionCalendar');



async function buildSchedule(options={})