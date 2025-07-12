import { mount } from '@vue/test-utils';

import SplitButton from '../SplitButton.vue';

function wrap(props: Record<string, any>) {
  return mount(SplitButton, { props });
}

describe('SplitButton.vue', () => {
  it('should have the correct label', () => {
    const wrapper = wrap({ label: 'hello' });

    expect(wrapper.get('button').text()).toEqual('hello');
  });

  it('should not have dropdown if no options given', () => {
    const wrapper = wrap({});

    expect(wrapper.find({ ref: 'indicator' }).exists()).toBeFalsy();
    expect(wrapper.find('ul').exists()).toBeFalsy();
  });

  it('should accept click and emit the correct value', async() => {
    const wrapper = wrap({ value: 'yes' });

    await wrapper.trigger('click');
    expect(wrapper.emitted('input')?.flat() ?? []).toContain('yes');
  });

  it('should not work when disabled', async() => {
    const wrapper = wrap({ value: 'yes', disabled: true });

    await wrapper.trigger('click');
    expect(wrapper.emitted('input')).toBeUndefined();
  });

  describe('dropdown handling', () => {
    let wrapper: ReturnType<typeof wrap>;

    beforeEach(async() => {
      wrapper = wrap({
        value:   'top',
        options: ['hello', 'world', { id: 'lorem', icon: 'sun' }, 'ipsum'],
      });
      wrapper.element.ownerDocument.firstElementChild?.appendChild(wrapper.element);
      await wrapper.get({ ref: 'indicator' }).trigger('click');
    });

    afterEach(() => {
      wrapper.element.parentElement?.removeChild(wrapper.element);
      wrapper.unmount();
    });

    it('should generate a dropdown', () => {
      expect(wrapper.findAll('ul li').length).toBeGreaterThan(0);
    });

    it('supports icons', () => {
      const icon = wrapper.find('ul li:nth-child(3) i');

      expect(icon).not.toBeNull();
      expect(icon.element.classList).toContain('icon');
      expect(icon.element.classList).toContain('icon-sun');
    });

    it('should trigger on click', async() => {
      const item = wrapper.findAll('ul li').filter(w => w.text() === 'hello')[0];

      await item.trigger('click');
      expect(Object.keys(wrapper.emitted())).toContain('input');
      expect(wrapper.emitted('input')?.flat() ?? []).not.toContain('top');
      expect(wrapper.emitted('input')?.flat() ?? []).toContain('hello');
    });

    it('should trigger on enter', async() => {
      const item = wrapper.findAll('ul li').filter(w => w.text() === 'hello')[0];

      await item.trigger('keypress.enter');
      expect(Object.keys(wrapper.emitted())).toContain('input');
      expect(wrapper.emitted('input')?.flat() ?? []).not.toContain('top');
      expect(wrapper.emitted('input')?.flat() ?? []).toContain('hello');
    });

    it('should trigger on space', async() => {
      const item = wrapper.findAll('ul li').filter(w => w.text() === 'hello')[0];

      await item.trigger('keypress.space');
      expect(Object.keys(wrapper.emitted())).toContain('input');
      expect(wrapper.emitted('input')?.flat() ?? []).not.toContain('top');
      expect(wrapper.emitted('input')?.flat() ?? []).toContain('hello');
    });

    it('should focus the first element by default', () => {
      const options = wrapper.findAll('ul li');
      const firstOption = options.filter(w => w.text() === 'hello')[0];
      const document = wrapper.element.ownerDocument;

      expect(document.activeElement).toBe(firstOption.element);
    });

    it('should focus on mouse over', async() => {
      const options = wrapper.findAll('ul li');
      const secondOption = options.filter(w => w.text() === 'world')[0];
      const document = wrapper.element.ownerDocument;

      expect(document.activeElement).not.toBe(secondOption.element);
      await secondOption.trigger('mouseover');
      expect(document.activeElement).toBe(secondOption.element);
    });

    it('should respond to arrow-up key', async() => {
      const options = wrapper.findAll('ul li');
      const document = wrapper.element.ownerDocument;
      const lastOption = options[options.length - 1];
      const secondLastOption = options[options.length - 2];

      await lastOption.trigger('mouseover');
      expect(document.activeElement).toBe(lastOption.element);
      await lastOption.trigger('keydown', { key: 'ArrowUp' });
      expect(document.activeElement).toBe(secondLastOption.element);
    });

    it('should respond to arrow-down key', async() => {
      const options = wrapper.findAll('ul li');
      const document = wrapper.element.ownerDocument;
      const firstOption = options[0];
      const secondOption = options[1];

      expect(document.activeElement).toBe(firstOption.element);
      await firstOption.trigger('keydown', { key: 'ArrowDown' });
      expect(document.activeElement).toBe(secondOption.element);
    });

    it('should respond to home key', async() => {
      const options = wrapper.findAll('ul li');
      const document = wrapper.element.ownerDocument;
      const firstOption = options[0];
      const secondOption = options[1];

      await secondOption.trigger('mouseover');
      expect(document.activeElement).toBe(secondOption.element);
      await secondOption.trigger('keydown', { key: 'Home' });
      expect(document.activeElement).toBe(firstOption.element);
    });

    it('should respond to end key', async() => {
      const options = wrapper.findAll('ul li');
      const document = wrapper.element.ownerDocument;
      const firstOption = options[0];
      const lastOption = options[options.length - 1];

      expect(document.activeElement).not.toBe(lastOption.element);
      await firstOption.trigger('keydown', { key: 'End' });
      expect(document.activeElement).toBe(lastOption.element);
    });
  });
});
