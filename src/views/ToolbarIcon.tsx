import Icon from './Icon';
import { Button } from './TooltipControls';

import * as React from 'react';

export interface IToolbarIconProps {
  id: string;
  instanceId?: string[];
  text: string;
  placement?: 'top' | 'right' | 'bottom' | 'left';
  buttonType?: 'icon' | 'text' | 'both';
  iconSet?: string;
  icon: string;
  onClick?: (ids: string[]) => void;
  pulse?: boolean;
  disabled?: boolean;
}

class ToolbarIcon extends React.PureComponent<IToolbarIconProps, {}> {
  public render(): JSX.Element {
    const { buttonType, id, text, icon, iconSet, pulse, disabled} = this.props;
    const placement = this.props.placement || 'bottom';
    let bType = buttonType || 'icon';
    return (
      <Button
        tooltip={text}
        id={id}
        placement={placement}
        onClick={this.invokeAction}
        disabled={disabled}
      >
        { ['icon', 'both'].indexOf(bType) !== -1
          ? <Icon set={iconSet} name={icon} pulse={pulse} />
          : null }
        { ['text', 'both'].indexOf(bType) !== -1
          ? <p className='btn-toolbar-text'>{text}</p>
          : null }
        { this.props.children }
      </Button>
    );
  }

  private invokeAction = () => {
    const { instanceId, onClick } = this.props;
    if (onClick !== undefined) {
      onClick(instanceId);
    }
  }
}

export default ToolbarIcon;
