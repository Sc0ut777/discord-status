import {StatuspageUpdates} from 'statuspage.js';
import {Guild, GuildModel, Update} from '../db/models';
import {EditModeEmbed} from '../util/embeds/Edit';
import {PostModeEmbed} from '../util/embeds/Post';

const s = new StatuspageUpdates(process.env.STATUSPAGE_ID!, 5_000);

s.on('incident_update', async i => {
  const update = i.incident_updates[0];
  const guilds = await GuildModel.find();

  const postEmbed = new PostModeEmbed(i);
  const editEmbed = new EditModeEmbed(i);

  for (const guild of guilds) {
    let s: Update | undefined;
    if ((s = guild.updates.find(a => a.incident === i.id))) {
      if (s.incident_updates.includes(update.id)) {
        continue; // somehow it's already sent this update
      }

      try {
        await sendUpdate(guild, s);

        s.incident_updates.push(update.id);

        await guild.save();

        continue;
      } catch (err) {
        console.error(err);
        continue;
      }
    }

    const sent = await sendUpdate(guild, s);

    guild.updates.push({
      msg_id: sent.id,
      incident: i.id,
      incident_updates: [update.id],
    });

    await guild.save();
  }

  function sendUpdate(guild: Guild, s?: Update) {
    const roles = guild.config.roles.map(r => `<@&${r}>`).join(' ');

    if (s?.msg_id && guild.config.mode === 'edit') {
      return guild.webhook.into().editMsg(s.msg_id, {
        content: roles,
        embeds: [editEmbed],
      });
    }

    return guild.webhook.into().send({
      content: roles,
      embeds: [guild.config.mode === 'edit' ? editEmbed : postEmbed],
    });
  }
});

s.start();