"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const data_source_1 = require("../data-source");
const site_entity_1 = require("../../sites/entities/site.entity");
const patrol_group_entity_1 = require("../../patrol-groups/entities/patrol-group.entity");
const patrol_schedule_entity_1 = require("../../patrol-schedules/entities/patrol-schedule.entity");
const patrol_slot_entity_1 = require("../../patrol-slots/entities/patrol-slot.entity");
const patrol_slot_status_enum_1 = require("../../common/enums/patrol-slot-status.enum");
const SITE_CODES = [
    'OXF01',
    'NYC02',
    'DAL03',
    'SFO04',
    'SEA05',
    'MIA06',
    'ATL07',
    'PHX08',
    'CHI09',
    'DEN10',
];
async function seed() {
    await data_source_1.default.initialize();
    const siteRepo = data_source_1.default.getRepository(site_entity_1.Site);
    const groupRepo = data_source_1.default.getRepository(patrol_group_entity_1.PatrolGroup);
    const scheduleRepo = data_source_1.default.getRepository(patrol_schedule_entity_1.PatrolSchedule);
    const slotRepo = data_source_1.default.getRepository(patrol_slot_entity_1.PatrolSlot);
    await groupRepo.delete({});
    await scheduleRepo.delete({});
    await slotRepo.delete({});
    await siteRepo.delete({});
    const today = new Date();
    const dayStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 0, 0, 0));
    for (const [index, siteCode] of SITE_CODES.entries()) {
        const site = await siteRepo.save(siteRepo.create({
            siteCode,
            siteName: `Security Site ${index + 1}`,
            clientName: `Client ${index + 1}`,
            active: true,
        }));
        await groupRepo.save(groupRepo.create({
            siteId: site.id,
            groupName: `${siteCode} Patrol Group`,
            externalGroupId: `wa-group-${siteCode.toLowerCase()}`,
            active: true,
        }));
        await scheduleRepo.save(scheduleRepo.create({
            siteId: site.id,
            frequencyMinutes: 60,
            startHour: 0,
            endHour: 23,
            graceMinutes: 15,
            activeDays: [0, 1, 2, 3, 4, 5, 6],
            active: true,
        }));
        const slots = [];
        for (let hour = 0; hour < 24; hour += 1) {
            const expectedAt = new Date(dayStart.getTime() + hour * 60 * 60 * 1000);
            const slotEnd = new Date(expectedAt.getTime() + 60 * 60 * 1000);
            slots.push(slotRepo.create({
                siteId: site.id,
                slotStart: expectedAt,
                expectedAt,
                slotEnd,
                status: patrol_slot_status_enum_1.PatrolSlotStatus.PENDING,
            }));
        }
        await slotRepo.save(slots);
    }
    await data_source_1.default.destroy();
    console.log('Seed completed for 10 demo sites with hourly schedules and today slots.');
}
void seed();
//# sourceMappingURL=seed.js.map