// All tools, in toolbar order.
import { selectTool } from './select.js';
import { driveTool } from './drive.js';
import { actuatorTool } from './actuator.js';
import { loadTool } from './load.js';
import { inputTool } from './input.js';
import { eraserTool } from './eraser.js';
import { pointTool, segmentTool, xlineTool, measureTool } from './basic.js';
import { compassTool } from './compass.js';
import { protractorTool } from './protractor.js';
import { groundTool, linkTool, couplerTool, sliderTool, bodyTool } from './mechanism.js';
import { imageTool, scaleTool } from './background.js';
import { wheelTool, prismaticTool, rollTool, rollSlideTool } from './pairs.js';

export const TOOLS = [
  selectTool, driveTool,
  pointTool, segmentTool, xlineTool, compassTool, protractorTool, measureTool, eraserTool,
  groundTool, linkTool, couplerTool, wheelTool, sliderTool, prismaticTool, rollTool, rollSlideTool, actuatorTool, inputTool, loadTool, bodyTool,
  imageTool, scaleTool,
];

export const toolById = (id) => TOOLS.find((t) => t.id === id);
