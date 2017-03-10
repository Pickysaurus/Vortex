import { showDialog } from '../../actions/notifications';
import { DialogActions, DialogType, IDialogContent, IDialogResult } from '../../types/IDialog';
import { IDiscoveredTool } from '../../types/IDiscoveredTool';
import { ComponentEx, connect, translate } from '../../util/ComponentEx';
import { log } from '../../util/log';
import { showError } from '../../util/message';
import { activeGameId } from '../../util/selectors';
import { getSafe } from '../../util/storeHelper';
import Icon from '../../views/Icon';

import { addDiscoveredTool,
         setToolVisible } from '../gamemode_management/actions/settings';

import { IDiscoveryResult } from '../gamemode_management/types/IDiscoveryResult';
import { IGameStored } from '../gamemode_management/types/IGameStored';
import { IToolStored } from '../gamemode_management/types/IToolStored';

import { setPrimaryTool } from './actions';

import runToolElevated from './runToolElevated';
import StarterInfo from './StarterInfo';
import ToolButton from './ToolButton';
import ToolEditDialog from './ToolEditDialog';

import * as Promise from 'bluebird';
import { execFile } from 'child_process';
import * as path from 'path';
import * as React from 'react';
import { Dropdown, Media, MenuItem } from 'react-bootstrap';
import update = require('react-addons-update');
import { generate as shortid } from 'shortid';

interface IWelcomeScreenState {
  editTool: StarterInfo;
  counter: number;
}

interface IActionProps {
  onAddDiscoveredTool: (gameId: string, toolId: string, result: IDiscoveredTool) => void;
  onSetToolVisible: (gameId: string, toolId: string, visible: boolean) => void;
  onShowError: (message: string, details?: string | Error) => void;
  onShowDialog: (type: DialogType, title: string, content: IDialogContent,
                 actions: DialogActions) => Promise<IDialogResult>;
  onMakePrimary: (gameId: string, toolId: string) => void;
}

interface IConnectedProps {
  gameMode: string;
  knownGames: IGameStored[];
  discoveredGames: { [id: string]: IDiscoveryResult };
  discoveredTools: { [id: string]: IDiscoveredTool };
  autoDeploy: boolean;
  primaryTool: string;
}

type IWelcomeScreenProps = IConnectedProps & IActionProps;

class Starter extends ComponentEx<IWelcomeScreenProps, IWelcomeScreenState> {
  constructor(props) {
    super(props);

    this.state = {
      editTool: undefined,
      counter: 1,
    };
  }

  public render(): JSX.Element {
    let { gameMode, knownGames } = this.props;

    if (gameMode === undefined) {
      return null;
    }

    let game: IGameStored = knownGames.find((ele) => ele.id === gameMode);

    return (
      <Media style={{ overflow: 'visible' }}>
        <Media.Left>
          {this.renderGameIcon(game)}
          {this.renderEditToolDialog()}
        </Media.Left>
        <Media.Right>
          <Media.Heading>
            {game === undefined ? gameMode : game.name}
          </Media.Heading>
          {this.renderToolIcons(game)}
        </Media.Right>
      </Media>
    );
  }

  private renderToolIcons(game: IGameStored): JSX.Element {
    const { discoveredGames, discoveredTools, primaryTool } = this.props;

    if (game === undefined) {
      return null;
    }

    const gameDiscovery = discoveredGames[game.id];

    const knownTools: IToolStored[] = game.supportedTools;
    const preConfTools = new Set<string>(knownTools.map(tool => tool.id));

    // add the main game executable
    let starters: StarterInfo[] = [
      new StarterInfo(game, gameDiscovery),
    ];

    // add the tools provided by the game extension (whether they are found or not)
    knownTools.forEach((tool: IToolStored) => {
      starters.push(new StarterInfo(game, gameDiscovery, tool, discoveredTools[tool.id]));
    });

    // finally, add those tools that were added manually
    Object.keys(discoveredTools)
      .filter(toolId => !preConfTools.has(toolId))
      .forEach(toolId => {
        try {
          starters.push(new StarterInfo(game, gameDiscovery, undefined, discoveredTools[toolId]));
        } catch (err) {
          log('error', 'tool configuration invalid', { gameId: game.id, toolId });
        }
      }
      );

    let primary = primaryTool || game.id;

    const hidden = starters.filter(starter =>
      (discoveredTools[starter.id] !== undefined)
      && (discoveredTools[starter.id].hidden === true)
    );

    const visible = starters.filter(starter =>
      starter.isGame
      || (starter.id === primary)
      || (discoveredTools[starter.id] === undefined)
      || (discoveredTools[starter.id].hidden !== true)
    );

    return (<div>
      {this.renderTool(starters.find(starter => starter.id === primary), true)}
      <div style={{ display: 'inline' }}>
        {visible.filter(starter => starter.id !== primary)
          .map(starter => this.renderTool(starter, false))}
        {this.renderAddButton(hidden)}
      </div>
    </div>);
  }

  private renderTool = (starter: StarterInfo, primary: boolean) => {
    const {t} = this.props;
    if (starter === undefined) {
      return null;
    }
    return <ToolButton
      t={t}
      key={starter.id}
      starter={starter}
      primary={primary}
      onRun={this.startTool}
      onEdit={this.editTool}
      onRemove={this.removeTool}
      onMakePrimary={this.makePrimary}
    />;
  }

  private renderAddButton(hidden: StarterInfo[]) {
    const {t} = this.props;
    // <IconButton id='add-tool-icon' icon='plus' tooltip={t('Add Tool')} />
    return (<Dropdown id='add-tool-button'>
      <Dropdown.Toggle>
        <Icon name='plus' />
      </Dropdown.Toggle>
      <Dropdown.Menu>
        {hidden.map(starter => <MenuItem
          key={starter.id}
          eventKey={starter.id}
          onSelect={this.unhide}
        >{starter.name}
        </MenuItem>)}
        <MenuItem
          key='__add'
          onSelect={this.addNewTool}
        >
        {t('New...')}
        </MenuItem>
      </Dropdown.Menu>
    </Dropdown>);
  }

  private unhide = (toolId: any) => {
    const { gameMode, onSetToolVisible }  = this.props;
    onSetToolVisible(gameMode, toolId, true);
  }

  private startTool = (starter: StarterInfo) => {
    const { t, onShowDialog, onShowError } = this.props;
    this.startDeploy()
    .then((doStart: boolean) => {
      if (doStart) {
        try {
          execFile(starter.exePath, {
            cwd: starter.workingDirectory,
            env: Object.assign({}, process.env, starter.environment),
          });
        } catch (err) {
          // TODO: as of the current electron version (1.4.14) the error isn't precise
          //   enough to determine if the error was actually lack of elevation but among
          //   the errors that report "UNKNOWN" this should be the most likely one.
          if (err.errno === 'UNKNOWN') {
            onShowDialog('question', t('Requires elevation'), {
              message: t('{{name}} cannot be started because it requires elevation. ' +
                'Would you like to run the tool elevated?', {
                  replace: {
                    name: starter.name,
                  },
                }),
              options: {
                translated: true,
              },
            }, {
              Cancel: null,
              'Run elevated': () => runToolElevated(starter, onShowError),
            });
          } else {
            log('info', 'failed to run custom tool', { err: err.message });
          }
        }
      }
    })
    .catch((err: Error) => {
      this.props.onShowError('Failed to activate', err);
    })
    ;
  }

  private startDeploy(): Promise<boolean> {
    const { autoDeploy, onShowDialog } = this.props;
    if (!autoDeploy) {
      return onShowDialog('question', 'Deploy now?', {
        message: 'You should deploy mods now, otherwise the mods in game '
               + 'will be outdated',
      }, {
        Cancel: null,
        Skip: null,
        Deploy: null,
      })
      .then((result) => {
        switch (result.action) {
          case 'Skip': return Promise.resolve(true);
          case 'Deploy': return new Promise<boolean>((resolve, reject) => {
            this.context.api.events.emit('activate-mods', (err) => {
              if (err !== null) {
                reject(err);
              } else {
                resolve(true);
              }
            });
          });
          default: return Promise.resolve(false);
        }
      });
    } else {
      return new Promise<boolean>((resolve, reject) => {
        this.context.api.events.emit('await-activation', (err: Error) => {
          if (err !== null) {
            reject(err);
          } else {
            resolve(true);
          }
        });
      });
    }
  }

  private renderGameIcon = (game: IGameStored): JSX.Element => {
    if (game === undefined) {
      // assumption is that this can only happen during startup
      return <Icon name='spinner' pulse />;
    } else {
      let logoPath = path.join(game.extensionPath, game.logo);
      return <img className='welcome-game-logo' src={logoPath} />;
    }
  }

  private renderEditToolDialog() {
    const { editTool } = this.state;
    if (editTool === undefined) {
      return null;
    }

    return (
      <ToolEditDialog
        tool={ editTool }
        onClose={ this.closeEditDialog }
      />
    );
  }

  private closeEditDialog = () => {
    // Through the counter, which is used in the key for the tool buttons
    // this also forces all tool buttons to be re-mounted to ensure the icon is
    // correctly updated
    this.setState(update(this.state, {
      editTool: { $set: undefined },
      counter: { $set: this.state.counter + 1 },
    }));
  }

  private addNewTool = () => {
    const { gameMode, discoveredGames, knownGames } = this.props;

    let game: IGameStored = knownGames.find(ele => ele.id === gameMode);
    let empty = new StarterInfo(game, discoveredGames[gameMode], undefined, {
      id: shortid(),
      path: '',
      hidden: false,
      custom: true,
      workingDirectory: '',
      name: '',
      executable: undefined,
      requiredFiles: [],
      logo: '',
    });
    this.setState(update(this.state, {
      editTool: { $set: empty },
    }));
  }

  private editTool = (starter: StarterInfo) => {
    this.setState(update(this.state, {
      editTool: { $set: starter },
    }));
  }

  private removeTool = (starter: StarterInfo) => {
    this.props.onSetToolVisible(starter.gameId, starter.id, false);
  };

  private makePrimary = (starter: StarterInfo) => {
    this.props.onMakePrimary(starter.gameId, starter.isGame ? undefined : starter.id);
  }
};

function mapStateToProps(state: any): IConnectedProps {
  let gameMode: string = activeGameId(state);

  return {
    gameMode,
    knownGames: state.session.gameMode.known,
    discoveredGames: state.settings.gameMode.discovered,
    discoveredTools: getSafe(state, [ 'settings', 'gameMode',
                                      'discovered', gameMode, 'tools' ], {}),
    autoDeploy: state.settings.automation.deploy,
    primaryTool: getSafe(state, ['settings', 'interface', 'primaryTool', gameMode], undefined),
  };
}

function mapDispatchToProps(dispatch: Redux.Dispatch<any>): IActionProps {
  return {
    onAddDiscoveredTool: (gameId: string, toolId: string, result: IDiscoveredTool) => {
      dispatch(addDiscoveredTool(gameId, toolId, result));
    },
    onSetToolVisible: (gameId: string, toolId: string, visible: boolean) => {
      dispatch(setToolVisible(gameId, toolId, visible));
    },
    onShowError: (message: string, details?: string | Error) =>
      showError(dispatch, message, details),
    onShowDialog: (type, title, content, actions) =>
      dispatch(showDialog(type, title, content, actions)),
    onMakePrimary: (gameId: string, toolId: string) => dispatch(setPrimaryTool(gameId, toolId)),
  };
}

export default
  translate(['common'], {
    wait: true,
    bindI18n: 'languageChanged loaded',
    bindStore: false,
  } as any)(
    connect(mapStateToProps, mapDispatchToProps)(Starter)
 );
