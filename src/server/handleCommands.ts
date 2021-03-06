import {Request, Response} from 'express';
import {Statuspage} from 'statuspage.js';
import {logger} from '..';
import extendedHelp from '../../cmds/help_text.json';
import {GuildModel} from '../db/models';
import {s} from '../updates';
import {
  allCmdJson,
  capitalize,
  inviteUrl,
  getStatusEmoji,
  statusToWords,
} from '../util';
import {
  Interaction,
  InteractionResponseFlags,
  InteractionResponseType,
} from 'slashy';
import {purgeWebhooks} from '../util/purgeWebhooks';
import {Webhook} from '../util/Webhook';

// load commands once
const commands = allCmdJson('cmds');

type ExtendedHelp = Record<string, 'subscribe'>;

const MANAGE_WEBHOOKS = 536870912;
const ADMINISTRATOR = 8;

export async function handleCommands(
  req: Request<{}, {}, Interaction>,
  res: Response
) {
  const i = new Interaction(req.body);
  logger.command(i);

  switch (i.data.name) {
    case 'config': {
      const permissions = i.member.permissions;

      if (
        (parseInt(permissions) & MANAGE_WEBHOOKS) !== MANAGE_WEBHOOKS &&
        (parseInt(permissions) & ADMINISTRATOR) !== ADMINISTRATOR
      ) {
        await sendPermError();
        break;
      }

      const subcmd = i.data!.options![0];

      const doc = await GuildModel.get(i.guild_id);

      if (!doc) {
        await i.send({
          type: InteractionResponseType.ChannelMessage,
          data: {
            flags: InteractionResponseFlags.EPHEMERAL,
            content:
              'I have not been configured for this server. Authorize using the link from `/invite` and try again.',
          },
        });

        break;
      }

      switch (subcmd.name) {
        case 'roles': {
          const action = subcmd.options![0];

          try {
            switch (action.name) {
              case 'add': {
                const rId = action.options!.find(o => o.name === 'role')!.value;

                if (doc.config.roles.includes(rId as string)) {
                  await i.send({
                    type: InteractionResponseType.ChannelMessage,
                    data: {
                      flags: InteractionResponseFlags.EPHEMERAL,
                      content:
                        'This role is already configured to be pinged when the status page updates.',
                    },
                  });

                  break;
                }

                doc.config.roles.push(action.options![0].value as string);

                await doc.save();

                await i.send({
                  type: InteractionResponseType.ChannelMessage,
                  data: {
                    flags: InteractionResponseFlags.EPHEMERAL,
                    content: `<@&${rId}> has been added to the role ping list.`,
                  },
                });
                break;
              }

              case 'remove': {
                const rId = action.options!.find(o => o.name === 'role')!.value;

                if (!doc.config.roles.includes(rId as string)) {
                  await i.send({
                    type: InteractionResponseType.ChannelMessage,
                    data: {
                      flags: InteractionResponseFlags.EPHEMERAL,
                      content: 'This role has not configured to be pinged.',
                    },
                  });

                  break;
                }

                doc.config.roles = doc.config.roles.filter(
                  (r: string) => r !== rId
                );

                await doc.save();

                await i.send({
                  type: InteractionResponseType.ChannelMessage,
                  data: {
                    flags: InteractionResponseFlags.EPHEMERAL,
                    content: `<@&${rId}> has been removed from the role ping list.`,
                  },
                });

                break;
              }

              case 'get': {
                await i.send({
                  type: InteractionResponseType.ChannelMessage,
                  data: {
                    flags: InteractionResponseFlags.EPHEMERAL,
                    content: `When the status page updates, the following roles will be pinged (${
                      doc.config.roles.length
                    }):\n> ${
                      doc.config.roles
                        .map((r: string) => `<@&${r}>`)
                        .join(', ') || 'none'
                    }`,
                  },
                });
                break;
              }
            }
          } catch (err) {
            await sendGenericError();
            logger.error(err);
          }
          break;
        }

        case 'mode': {
          const modes = ['edit', 'post'];

          const mode = subcmd.options![0].name;

          if (!modes.includes(mode)) {
            await i.send({
              type: InteractionResponseType.ChannelMessage,
              data: {
                flags: InteractionResponseFlags.EPHEMERAL,
                content: 'Unknown mode.',
              },
            });

            break;
          }

          if (doc.config.mode === mode) {
            await i.send({
              type: InteractionResponseType.ChannelMessage,
              data: {
                flags: InteractionResponseFlags.EPHEMERAL,
                content: `Your server is already set to ${mode} mode.`,
              },
            });

            break;
          }

          try {
            doc.config.mode = mode;

            await doc.save();

            await i.send({
              type: InteractionResponseType.ChannelMessage,
              data: {
                flags: InteractionResponseFlags.EPHEMERAL,
                content: `Enabled ${mode} mode.`,
              },
            });
            break;
          } catch (err) {
            await sendGenericError();

            logger.error(err);
          }

          break;
        }

        case 'get': {
          await i.send({
            type: InteractionResponseType.ChannelMessage,
            data: {
              flags: InteractionResponseFlags.EPHEMERAL,
              content: doc.config.pretty(),
            },
          });

          break;
        }
      }
      break;
    }

    case 'help': {
      if (
        i.data?.options?.[0].value &&
        Object.keys(extendedHelp).includes(i.data.options[0].value as string)
      ) {
        const msg = (extendedHelp as ExtendedHelp)[
          i.data.options[0].value as string
        ];

        await i.send({
          type: InteractionResponseType.ChannelMessage,
          data: {
            flags: InteractionResponseFlags.EPHEMERAL,
            content: msg || 'Documentation unavailable.',
          },
        });

        break;
      }

      const hidden = ['test', 'mod'];

      const start = '-- **Commands** --\n';
      const c = (await commands)
        .filter(c => !hidden.includes(c.name))
        .map(c => `\`${c.name}\` \u21D2 ${c.description}`)
        .join('\n');
      const end = '\n\nNote: most commands have several subcommands.';

      await i.send({
        type: InteractionResponseType.ChannelMessage,
        data: {
          flags: InteractionResponseFlags.EPHEMERAL,
          content: start + c + end,
        },
      });

      break;
    }

    case 'invite': {
      await i.send({
        type: InteractionResponseType.ChannelMessage,
        data: {
          flags: InteractionResponseFlags.EPHEMERAL,
          content: inviteUrl() || 'You cannot invite me to your server.',
        },
      });

      break;
    }

    case 'mod': {
      if (
        !global.config.admins?.includes(i.member.user.id) &&
        !global.config.mods?.includes(i.member.user.id)
      ) {
        await sendPermError();
        return;
      }
      const action = i.data!.options![0];

      switch (action.name) {
        case 'announce': {
          if (!global.config.admins?.includes(i.member.user.id)) {
            await sendPermError();
            break;
          }

          await i.send({
            type: InteractionResponseType.ChannelMessageWithSource,
            data: {
              content: 'Sending your announcement...This may take a while...',
            },
          });

          const guilds = await GuildModel.find();

          const body = {
            content: `**Announcement from ${i.member.user.username}#${
              i.member.user.discriminator
            }**\n> ${
              action?.options?.find(o => o.name === 'announcement')?.value
            }`,
          };

          const whs = [
            ...guilds.map(g => g.webhook),
            ...(global.config.webhooks || []),
          ].map(w => new Webhook(w).send(body));

          const sent = await Promise.allSettled(whs);

          const success = sent.filter(
            s => s.status === 'fulfilled' && s.value?.webhook_id
          );

          await i.edit({
            content: `Successfully sent your announcement to ${success.length}/${whs.length} webhooks.`,
          });

          break;
        }

        case 'purge': {
          if (!global.config.admins?.includes(i.member.user.id)) {
            await sendPermError();
            break;
          }

          const dryrun = !!i.data.options?.[0]?.options?.find(
            o => o.name === 'dryrun'
          )?.value;

          const result = await purgeWebhooks(dryrun);

          await i.send({
            type: InteractionResponseType.ChannelMessage,
            data: {
              flags: InteractionResponseFlags.EPHEMERAL,
              content: `**Total**: ${result.total}\n> **Valid**: ${result.valid}\n> **Invalid**: ${result.invalid}\n> **Deleted**: ${result.deleted}`,
            },
          });

          if (!dryrun) {
            logger.log(
              `[MANUAL] Deleted ${result.deleted}/${result.invalid} invalid webhooks.`
            );
          }

          break;
        }

        case 'start': {
          if (s.active) {
            await i.send({
              type: InteractionResponseType.ChannelMessage,
              data: {
                flags: InteractionResponseFlags.EPHEMERAL,
                content:
                  'The status page is already being checked for updates.',
              },
            });

            break;
          }

          await s.start();

          await i.send({
            type: InteractionResponseType.ChannelMessage,
            data: {
              flags: InteractionResponseFlags.EPHEMERAL,
              content: 'Started checking the status page for updates',
            },
          });

          break;
        }

        case 'stop': {
          if (!s.active) {
            await i.send({
              type: InteractionResponseType.ChannelMessage,
              data: {
                flags: InteractionResponseFlags.EPHEMERAL,
                content: 'The status page is not being checked for updates.',
              },
            });

            break;
          }

          s.stop();

          await i.send({
            type: InteractionResponseType.ChannelMessage,
            data: {
              flags: InteractionResponseFlags.EPHEMERAL,
              content: 'Stopped checking the status page for updates',
            },
          });

          break;
        }
      }
      break;
    }

    case 'about': {
      const guilds = await GuildModel.estimatedDocumentCount();

      await i.send({
        type: InteractionResponseType.ChannelMessage,
        data: {
          flags: InteractionResponseFlags.EPHEMERAL,
          content:
            '**Discord Status**:\n' +
            '> **Author**: [Ben!#0002](https://red-panda.red)\n' +
            '> **GitHub Repo**: <https://github.com/benricheson101/discord-status>\n' +
            `> **Webhooks**: ${guilds}`,
        },
      });

      break;
    }

    case 'status': {
      const s = new Statuspage(
        global.config.status_page.id || process.env.STATUSPAGE_ID!
      );
      const component = i.data!.options![0];

      const summary = await s.summary();
      const voiceComponentIds = summary.components?.find(
        c => c.name === 'Voice'
      )?.components;

      let content = 'No available data.';

      switch (component.name) {
        case 'summary': {
          const notVoiceComponents = summary.components
            ?.filter(c => !voiceComponentIds?.includes(c.id))
            ?.sort((a, b) => (a.name > b.name ? 1 : -1));

          content =
            `**Status**: ${summary.status.description}\n` +
              notVoiceComponents
                ?.map(
                  c =>
                    `> ${getStatusEmoji(c.status)} **${c.name}**: ${capitalize(
                      statusToWords(c.status)
                    )}`
                )
                .join('\n') || 'No component data available.';
          break;
        }

        case 'voice': {
          const voiceComponents = voiceComponentIds
            ?.map(c => summary.components?.find(a => a.id === c) || null)
            .filter(Boolean)
            .sort((a, b) => (a!.name > b!.name ? 1 : -1));

          content =
            '**Voice Server Status**:\n' +
              voiceComponents
                ?.map(
                  c =>
                    c &&
                    `> ${getStatusEmoji(c.status)} **${c.name}**: ${capitalize(
                      statusToWords(c.status)
                    )}`
                )
                .join('\n') || 'No voice data available.';
          break;
        }
      }

      await i.send({
        type: InteractionResponseType.ChannelMessage,
        data: {
          flags: InteractionResponseFlags.EPHEMERAL,
          content,
        },
      });

      break;
    }

    case 'support': {
      const code =
        global.config.meta?.support_server || process.env.SUPPORT_SERVER;

      await i.send({
        type: InteractionResponseType.ChannelMessage,
        data: {
          flags: InteractionResponseFlags.EPHEMERAL,
          content: code ? `https://discord.gg/${code}` : '¯\\_(ツ)\_/¯', // eslint-disable-line
        },
      });

      break;
    }

    case 'unsubscribe': {
      const permissions = i.member.permissions;

      if (
        (parseInt(permissions) & MANAGE_WEBHOOKS) !== MANAGE_WEBHOOKS &&
        (parseInt(permissions) & ADMINISTRATOR) !== ADMINISTRATOR
      ) {
        await sendPermError();
        break;
      }

      try {
        const result: {
          n?: number;
          ok?: number;
          deletedCount?: number;
        } = await GuildModel.deleteOne({guild_id: i.guild_id}).exec();

        if (result.n && result.ok) {
          await i.send({
            type: InteractionResponseType.ChannelMessage,
            data: {
              flags: InteractionResponseFlags.EPHEMERAL,
              content: 'You will no longer receive status updates.',
            },
          });

          break;
        } else if (!result.n && result.ok) {
          await i.send({
            type: InteractionResponseType.ChannelMessage,
            data: {
              flags: InteractionResponseFlags.EPHEMERAL,
              content: 'You are not subscribed to status page updates.',
            },
          });

          break;
        } else {
          throw new Error();
        }
      } catch (err) {
        await sendGenericError();

        if (err.message) {
          logger.error(err);
        }
      }

      break;
    }
  }

  return res.sendStatus(200);

  async function sendGenericError() {
    return i.send({
      type: InteractionResponseType.ChannelMessage,
      data: {
        flags: InteractionResponseFlags.EPHEMERAL,
        content:
          'An unhandled error occurred, try running the command again. If this continues happening, join the support server (`/support`) for help.',
      },
    });
  }

  async function sendPermError() {
    return i.send({
      type: InteractionResponseType.ChannelMessage,
      data: {
        flags: InteractionResponseFlags.EPHEMERAL,
        content: 'You do not have permission to use this command.',
      },
    });
  }
}
